import fs from 'fs';
import crypto from 'crypto';
import { Router } from 'express';
import { inferenceServer } from '../services/inferenceServer.js';
import { activityState } from '../services/activityState.js';
import {
  synthesizeLongText,
  synthesizeLongTextStreaming,
  cancelSession,
  applyFullInferenceQualityPreset,
  fullInferenceQualityOptions,
  analyzeAudioQuality,
  buildAttemptVariants,
  scoreAudioCandidate,
} from '../services/longTextInference.js';
import { inferenceState } from '../services/inferenceState.js';
import { sseManager } from '../services/sseManager.js';
import { resolveRefAudioParams } from '../services/refAudioCache.js';
import { prepareTextForSynthesis } from '../services/textPronunciation.js';
import { applyEmphasisAndSpelling } from '../services/emphasisAndSpelling.js';
import { COMMA_PAUSE_SECONDS, TRANSCRIPTION_VERIFY_ENABLED, SPEAKER_VERIFY_ENABLED } from '../config.js';
import {
  prepareTextWithRuntimeDictionary,
  syncHotDictionaryOverrides,
  loadRuntimePronunciationEntries,
} from '../services/runtimePronunciationDictionary.js';
import { transcriptionVerifier } from '../services/transcriptionVerifier.js';
import { speakerSimilarity } from '../services/speakerSimilarity.js';
import { isDemoRequest, preemptActiveGeneration } from '../services/demoPreempt.js';

const router = Router();

// Per-chunk acceptance check for the chunked full-quality path. A take is accepted
// only when ASR confirms it spoke all the words (no skipped/clipped words) AND it
// still sounds like the reference voice. Either check degrades to "no opinion" if
// its sidecar is unavailable, so synthesis is never blocked by a verification fault.
function verificationOptions(params = {}) {
  const useAsr = TRANSCRIPTION_VERIFY_ENABLED;
  const refAudioPath = params.ref_audio_path || '';
  const useSpeaker = SPEAKER_VERIFY_ENABLED && Boolean(refAudioPath);
  if (!useAsr && !useSpeaker) return {};

  return {
    verifyChunk: async (audioBuffer, expectedText) => {
      // Admin pronunciation-dictionary words are rare medical terms Whisper often
      // mis-transcribes; pass them so the verifier checks their PRESENCE (word count)
      // rather than demanding correct spelling — kills wasted re-rolls on those words.
      let dictionaryWords = [];
      if (useAsr) {
        try {
          const entries = await loadRuntimePronunciationEntries();
          dictionaryWords = entries.map((e) => e.word).filter(Boolean);
        } catch { /* no dictionary → strict spelling check, as before */ }
      }
      const [asr, speaker] = await Promise.all([
        useAsr ? transcriptionVerifier.verifyChunk(audioBuffer, expectedText, { dictionaryWords }) : null,
        useSpeaker ? speakerSimilarity.scoreChunk(refAudioPath, audioBuffer) : null,
      ]);
      if (!asr && !speaker) return null;
      return {
        ok: (asr ? asr.ok : true) && (speaker ? speaker.ok : true),
        coverage: asr?.coverage ?? 1,
        missingWords: asr?.missingWords ?? [],
        suspectWords: asr?.suspectWords ?? [],
        skippedWords: asr?.skippedWords ?? [],
        words: asr?.words ?? [],
        transcript: asr?.transcript,
        similarity: speaker?.similarity,
        similarityOk: speaker ? speaker.ok : null,
      };
    },
  };
}

function readInferenceParams(body) {
  const {
    text,
    text_lang = 'en',
    ref_audio_path,
    prompt_text = '',
    prompt_lang = 'en',
    aux_ref_audio_paths = [],
    top_k = 5,
    top_p = 0.85,
    temperature = 0.7,
    repetition_penalty = 1.35,
    speed_factor = 1.0,
    seed = -1,
  } = body;

  return {
    text,
    text_lang,
    ref_audio_path,
    prompt_text,
    prompt_lang,
    aux_ref_audio_paths,
    top_k,
    top_p,
    temperature,
    repetition_penalty,
    speed_factor,
    seed,
  };
}

// Live Fast retries each chunk up to this many times (total takes = value + 1). Kept
// lower than Live Full (which does 5 + sentence-split escalation) so Live Fast stays
// fast: the common case early-accepts on the first clean take, and a stubborn chunk
// spends at most a few extra seeds before shipping best-effort. Live Fast never splits
// a chunk below itself — it re-seeds the WHOLE chunk, then keeps the best take.
const LIVE_FAST_RETRY_COUNT = 2;

// Synthesize ONE Live Fast chunk with the same anti-skip logic Live Full uses per
// chunk (re-seed retries + ASR/quality verification + best-effort fallback), but
// WITHOUT sentence-splitting. Each take keeps the caller's Live Fast synth params
// (cut0, sampling, fragment_interval); only the seed varies between takes. Accepts the
// first take that passes quality analysis AND word-coverage verification; if none pass
// within the retry budget, ships the highest-scoring take (most complete / least
// clipped) so a stubborn chunk still speaks every word rather than failing the reply.
async function synthesizeLiveFastChunk(baseParams, {
  synthesize,
  verifyChunk = null,
  retryCount = LIVE_FAST_RETRY_COUNT,
} = {}) {
  const chunkText = String(baseParams.text || '').trim();
  const maxRetries = Math.max(0, Number.isFinite(retryCount) ? retryCount : LIVE_FAST_RETRY_COUNT);
  let lastError = null;
  let best = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const params = buildAttemptVariants({ ...baseParams, text: `${chunkText} ` }, attempt);
    try {
      const audioBuffer = await synthesize(params);

      // If the buffer can't be analyzed (e.g. an unexpected/edge format), don't reject
      // on that basis — treat quality as "no opinion" and let verification decide.
      let analysis;
      try {
        analysis = analyzeAudioQuality(audioBuffer, chunkText);
      } catch {
        // Can't analyze this buffer — treat it as acceptable (not silent) so scoring is
        // driven by word-coverage verification rather than a false "silent audio" penalty.
        analysis = {
          ok: true,
          durationSec: 0,
          reason: null,
          metrics: { rms: 0.02, absPeak: 0.02, zeroishRatio: 0, clippedRatio: 0, longestQuietSec: 0, loopScore: 0 },
        };
      }

      // Only spend ASR on takes whose audio already looks usable.
      let verification = null;
      if (verifyChunk && analysis.ok) {
        verification = await verifyChunk(audioBuffer, chunkText);
      }

      const score = scoreAudioCandidate(analysis, verification);
      if (!best || score > best.score) best = { audioBuffer, score };

      if (!analysis.ok) throw new Error(analysis.reason || 'Audio failed quality analysis');
      if (verification && !verification.ok) {
        throw new Error(`Take rejected — covered ${((verification.coverage ?? 0) * 100).toFixed(0)}% of the text`);
      }
      return audioBuffer;
    } catch (err) {
      lastError = err;
    }
  }

  // Best-effort fallback: never fail a Live Fast reply on a stubborn chunk — ship the
  // most complete / least-clipped take we saw.
  if (best) {
    console.warn(`[live-fast] kept best-effort take after ${maxRetries + 1} seeds: ${lastError?.message}; text="${chunkText.slice(0, 80)}"`);
    return best.audioBuffer;
  }
  throw lastError || new Error('Live Fast synthesis produced no audio');
}

export async function handleLiveTtsRequest(body, {
  resolveParams = resolveRefAudioParams,
  synthesize = (params) => inferenceServer.synthesize(params),
  verifyChunk,
  retryCount,
} = {}) {
  const resolvedParams = await resolveParams(body);
  const dictionaryText = await prepareTextWithRuntimeDictionary(resolvedParams.text);
  const emphasizedText = applyEmphasisAndSpelling(dictionaryText);
  const normalizedParams = {
    ...resolvedParams,
    text: prepareTextForSynthesis(emphasizedText),
    // cut0 = "no forced split": feed the whole chunk in and let the model choose its
    // own pauses (natural prosody), same as Live Full. The Live Fast lambda always
    // sends cut0; this fallback only applies if a caller omits it.
    text_split_method: resolvedParams.text_split_method || 'cut0',
    // Comma/clause pause length (GPT-SoVITS fragment_interval), tunable via COMMA_PAUSE_SECONDS.
    fragment_interval: resolvedParams.fragment_interval ?? COMMA_PAUSE_SECONDS,
  };
  const activeVerifyChunk = verifyChunk !== undefined
    ? verifyChunk
    : (verificationOptions(normalizedParams).verifyChunk || null);
  const audioBuffer = await synthesizeLiveFastChunk(normalizedParams, {
    synthesize,
    verifyChunk: activeVerifyChunk,
    retryCount,
  });
  return { audioBuffer, resolvedParams: normalizedParams };
}

router.get('/inference/status', async (_req, res) => {
  try {
    const status = await inferenceServer.getStatus();
    res.json({
      ...status,
      verification: {
        enabled: TRANSCRIPTION_VERIFY_ENABLED,
        ...transcriptionVerifier.getStatus(),
      },
      speaker: {
        enabled: SPEAKER_VERIFY_ENABLED,
        ...speakerSimilarity.getStatus(),
      },
    });
  } catch (err) {
    res.status(500).json({
      ready: false,
      error: err.message,
      loaded: inferenceServer.getLoadedWeights(),
      managed: false,
    });
  }
});

router.post('/inference/start', async (_req, res) => {
  try {
    const sync = await syncHotDictionaryOverrides();
    // engdict-hot.rep is only read by api_v2.py when it rebuilds the compiled
    // dictionary (engdict_cache.pickle). The sync rewrites the hot file AND drops a
    // stale cache so the rebuild actually happens; either event means a running
    // process still holds the previous pronunciations in memory. Stop it so start()
    // below respawns it, regenerates the cache from the hot file, and reloads the
    // updated dictionary. (cacheInvalidated covers an already-current hot file whose
    // entries never made it into a pre-existing stale cache.)
    if ((sync.changed || sync.cacheInvalidated) && inferenceServer.isRunning()) {
      inferenceServer.stop();
    }
    const status = await inferenceServer.start();
    activityState.mark();
    res.json(status);
  } catch (err) {
    res.status(500).json({
      ready: false,
      error: err.message,
      loaded: inferenceServer.getLoadedWeights(),
      managed: false,
    });
  }
});

router.post('/inference/stop', (_req, res) => {
  try {
    const status = inferenceServer.stop();
    activityState.mark();
    res.json(status);
  } catch (err) {
    res.status(500).json({
      ready: false,
      error: err.message,
      loaded: inferenceServer.getLoadedWeights(),
      managed: false,
    });
  }
});

router.post('/inference/weights/gpt', async (req, res) => {
  const { weightsPath } = req.body;
  if (!weightsPath) {
    return res.status(400).json({ error: 'weightsPath is required' });
  }
  if (!fs.existsSync(weightsPath)) {
    return res.status(404).json({ error: `GPT weights file not found: ${weightsPath}` });
  }

  try {
    const status = await inferenceServer.setGPTWeights(weightsPath);
    activityState.mark();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/inference/weights/sovits', async (req, res) => {
  const { weightsPath } = req.body;
  if (!weightsPath) {
    return res.status(400).json({ error: 'weightsPath is required' });
  }
  if (!fs.existsSync(weightsPath)) {
    return res.status(404).json({ error: `SoVITS weights file not found: ${weightsPath}` });
  }

  try {
    const status = await inferenceServer.setSoVITSWeights(weightsPath);
    activityState.mark();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/inference/tts', async (req, res) => {
  try {
    activityState.mark();
    // Demo Live Fast requests take GPU priority: cancel any in-flight Live Full session
    // so this phrase runs next. (No-op if nothing is running. The in-flight Live Fast
    // phrase, if any, is not tracked/cancellable and simply finishes — see demoPreempt.)
    if (isDemoRequest(req)) {
      preemptActiveGeneration();
    }
    const { audioBuffer } = await handleLiveTtsRequest(req.body);
    activityState.mark();

    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': audioBuffer.length,
    });
    res.send(audioBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/inference', async (req, res) => {
  const params = readInferenceParams(req.body);

  if (!params.text) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (!params.ref_audio_path) {
    return res.status(400).json({ error: 'ref_audio_path is required' });
  }

  try {
    const status = await inferenceServer.getStatus();
    if (!status.ready) {
      return res.status(503).json({ error: status.error || 'Inference server is not ready. Load models first.' });
    }

    activityState.mark();
    const resolvedParams = await resolveRefAudioParams(params);
    resolvedParams.text = applyEmphasisAndSpelling(await prepareTextWithRuntimeDictionary(resolvedParams.text));
    const qualityParams = applyFullInferenceQualityPreset(resolvedParams);
    const { audioBuffer, chunks } = await synthesizeLongText(qualityParams, fullInferenceQualityOptions(verificationOptions(qualityParams)));
    activityState.mark();

    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': audioBuffer.length,
      'X-Chunk-Count': String(chunks.length),
      'X-Chunk-Retries': String(chunks.reduce((sum, chunk) => sum + Math.max(0, chunk.attempts - 1), 0)),
    });
    res.send(audioBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/inference/generate', async (req, res) => {
  const params = readInferenceParams(req.body);

  if (!params.text) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (!params.ref_audio_path) {
    return res.status(400).json({ error: 'ref_audio_path is required' });
  }

  try {
    const status = await inferenceServer.getStatus();
    if (!status.ready) {
      return res.status(503).json({ error: status.error || 'Inference server is not ready. Load models first.' });
    }
    if (['waiting', 'generating'].includes(inferenceState.getState().status)) {
      // Demo requests (X-Demo-Request from the demo CloudFront) jump the queue: cancel
      // the in-flight generation and take over. All other traffic keeps the 409.
      if (isDemoRequest(req)) {
        preemptActiveGeneration();
      } else {
        return res.status(409).json({ error: 'Another generation is already running on this instance' });
      }
    }

    const resolvedParams = await resolveRefAudioParams(params);
    resolvedParams.text = applyEmphasisAndSpelling(await prepareTextWithRuntimeDictionary(resolvedParams.text));
    const qualityParams = applyFullInferenceQualityPreset(resolvedParams);
    const sessionId = crypto.randomUUID();
    inferenceState.resetForNewSession({ sessionId, params: qualityParams });
    sseManager.prepareSession(sessionId);
    res.json({ sessionId });

    synthesizeLongTextStreaming(sessionId, qualityParams, fullInferenceQualityOptions(verificationOptions(qualityParams))).catch((err) => {
      console.error(`[inference/generate] failed for ${sessionId}:`, err.message);
      inferenceState.setError(err.message);
      sseManager.send(sessionId, 'error', { message: err.message });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/inference/progress/:sessionId', (req, res) => {
  sseManager.addClient(req.params.sessionId, res);
});

router.post('/inference/cancel', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const cancelled = cancelSession(sessionId);
  // Always drive state terminal so a stale non-terminal state can be cleared,
  // even if the session already ended (no active session left to signal).
  if (['waiting', 'generating'].includes(inferenceState.getState().status)) {
    inferenceState.setError('Generation cancelled by user', 'cancelled');
  }
  res.json({ cancelled });
});

router.get('/inference/current', (_req, res) => {
  res.json(inferenceState.getState());
});

export default router;
