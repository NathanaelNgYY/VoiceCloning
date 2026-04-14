import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { WEIGHT_DIRS, GPT_SOVITS_ROOT, DATA_ROOT, getConfigError } from '../config.js';
import { inferenceServer } from '../services/inferenceServer.js';
import { sseManager } from '../services/sseManager.js';
import { synthesizeLongText, synthesizeLongTextStreaming, cancelSession, getSessionFinalPath } from '../services/longTextInference.js';
import { inferenceState } from '../services/inferenceState.js';
import { transcribeReferenceAudio } from '../services/transcriptionService.js';

const router = Router();

const SUPPORTED_TEXT_SPLIT_METHODS = new Set(['cut0', 'cut1', 'cut2', 'cut3', 'cut4', 'cut5']);
const QUALITY_PRESETS = {
  studio: {
    maxChunkLength: 240,
    maxSentencesPerChunk: 2,
    chunkJoinPauseMs: 100,
    retryCount: 3,
    textSplitMethod: 'cut0',
    fragmentInterval: 0.22,
    batchSize: 1,
    splitBucket: true,
    parallelInfer: false,
  },
  balanced: {
    maxChunkLength: 300,
    maxSentencesPerChunk: 3,
    chunkJoinPauseMs: 90,
    retryCount: 2,
    textSplitMethod: 'cut0',
    fragmentInterval: 0.18,
    batchSize: 1,
    splitBucket: true,
    parallelInfer: false,
  },
  flow: {
    maxChunkLength: 360,
    maxSentencesPerChunk: 4,
    chunkJoinPauseMs: 70,
    retryCount: 2,
    textSplitMethod: 'cut0',
    fragmentInterval: 0.15,
    batchSize: 1,
    splitBucket: true,
    parallelInfer: false,
  },
};
const TRANSCRIPTION_LANGUAGE_MAP = {
  zh: 'zh',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  ZH: 'zh',
  EN: 'en',
  JA: 'ja',
  KO: 'ko',
};

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function clampInteger(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max));
}

function readBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function normalizeTextSplitMethod(value, fallback) {
  const next = String(value || '').trim().toLowerCase();
  return SUPPORTED_TEXT_SPLIT_METHODS.has(next) ? next : fallback;
}

function resolveInferenceOptions(body = {}) {
  const requestedPreset = String(body.quality_preset || '').trim().toLowerCase();
  const presetKey = QUALITY_PRESETS[requestedPreset] ? requestedPreset : 'studio';
  const preset = QUALITY_PRESETS[presetKey];

  return {
    qualityPreset: presetKey,
    synthParams: {
      text_split_method: normalizeTextSplitMethod(body.text_split_method, preset.textSplitMethod),
      fragment_interval: clampNumber(body.fragment_interval, preset.fragmentInterval, 0.05, 0.5),
      batch_size: clampInteger(body.batch_size, preset.batchSize, 1, 4),
      split_bucket: readBoolean(body.split_bucket, preset.splitBucket),
      parallel_infer: readBoolean(body.parallel_infer, preset.parallelInfer),
    },
    chunkOptions: {
      maxChunkLength: clampInteger(body.max_chunk_length, preset.maxChunkLength, 120, 480),
      maxSentencesPerChunk: clampInteger(body.max_sentences_per_chunk, preset.maxSentencesPerChunk, 1, 6),
      chunkJoinPauseMs: clampInteger(body.chunk_join_pause_ms, preset.chunkJoinPauseMs, 0, 240),
      retryCount: clampInteger(body.retry_count, preset.retryCount, 0, 5),
    },
  };
}

async function resolvePromptContext({ refAudioPath, promptText, promptLang }) {
  const trimmedPromptText = String(promptText || '').trim();
  const normalizedPromptLang = String(promptLang || 'en').trim() || 'en';

  if (trimmedPromptText) {
    return {
      promptText: trimmedPromptText,
      promptLang: normalizedPromptLang,
      autoFilled: false,
    };
  }

  const transcription = await transcribeReferenceAudio(refAudioPath, {
    language: normalizedPromptLang || 'auto',
    model: 'medium',
  });
  const detectedPromptText = String(transcription?.text || '').trim();
  if (!detectedPromptText) {
    throw new Error('Reference audio transcription was empty. Enter the transcript manually and try again.');
  }

  return {
    promptText: detectedPromptText,
    promptLang: normalizedPromptLang === 'auto'
      ? (TRANSCRIPTION_LANGUAGE_MAP[transcription?.language] || 'en')
      : normalizedPromptLang,
    autoFilled: true,
  };
}

router.get('/models', (_req, res) => {
  const configError = getConfigError();
  if (configError) {
    return res.status(500).json({ error: configError });
  }

  try {
    const gptFiles = fs.existsSync(WEIGHT_DIRS.gpt)
      ? fs.readdirSync(WEIGHT_DIRS.gpt).filter(f => f.endsWith('.ckpt'))
      : [];

    const sovitsFiles = fs.existsSync(WEIGHT_DIRS.sovits)
      ? fs.readdirSync(WEIGHT_DIRS.sovits).filter(f => f.endsWith('.pth'))
      : [];

    res.json({
      gpt: gptFiles.map(f => ({ name: f, path: path.join(WEIGHT_DIRS.gpt, f) })),
      sovits: sovitsFiles.map(f => ({ name: f, path: path.join(WEIGHT_DIRS.sovits, f) })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/models/select', async (req, res) => {
  const { gptPath, sovitsPath } = req.body;
  const configError = getConfigError({ requirePython: true });
  if (configError) {
    return res.status(500).json({ error: configError });
  }

  try {
    if (!inferenceServer.isReady()) {
      await inferenceServer.start();
    }

    if (sovitsPath) {
      await inferenceServer.setSoVITSWeights(sovitsPath);
    }
    if (gptPath) {
      await inferenceServer.setGPTWeights(gptPath);
    }

    res.json({
      message: 'Models loaded successfully',
      loaded: inferenceServer.getLoadedWeights(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/inference', async (req, res) => {
  const configError = getConfigError({ requirePython: true });
  if (configError) {
    return res.status(500).json({ error: configError });
  }

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
  } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (!ref_audio_path) {
    return res.status(400).json({ error: 'ref_audio_path is required' });
  }

  try {
    if (!inferenceServer.isReady()) {
      return res.status(503).json({ error: 'Inference server is not running. Load models first.' });
    }

    const inferenceOptions = resolveInferenceOptions(req.body);
    const promptContext = await resolvePromptContext({
      refAudioPath: ref_audio_path,
      promptText: prompt_text,
      promptLang: prompt_lang,
    });

    const { audioBuffer, chunks } = await synthesizeLongText({
      text,
      text_lang,
      ref_audio_path,
      prompt_text: promptContext.promptText,
      prompt_lang: promptContext.promptLang,
      aux_ref_audio_paths,
      top_k,
      top_p,
      temperature,
      repetition_penalty,
      speed_factor,
      seed,
      ...inferenceOptions.synthParams,
    }, inferenceOptions.chunkOptions);

    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': audioBuffer.length,
      'X-Chunk-Count': String(chunks.length),
      'X-Chunk-Retries': String(chunks.reduce((sum, chunk) => sum + Math.max(0, chunk.attempts - 1), 0)),
      'X-Quality-Preset': inferenceOptions.qualityPreset,
      'X-Auto-Transcribed-Prompt': promptContext.autoFilled ? 'true' : 'false',
    });
    res.send(audioBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Streaming inference endpoints ──

router.post('/inference/generate', async (req, res) => {
  const configError = getConfigError({ requirePython: true });
  if (configError) {
    return res.status(500).json({ error: configError });
  }

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
  } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (!ref_audio_path) {
    return res.status(400).json({ error: 'ref_audio_path is required' });
  }

  if (!inferenceServer.isReady()) {
    return res.status(503).json({ error: 'Inference server is not running. Load models first.' });
  }

  let promptContext;
  let inferenceOptions;
  try {
    inferenceOptions = resolveInferenceOptions(req.body);
    promptContext = await resolvePromptContext({
      refAudioPath: ref_audio_path,
      promptText: prompt_text,
      promptLang: prompt_lang,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const sessionId = crypto.randomUUID();
  inferenceState.resetForNewSession({
    sessionId,
    params: {
      text,
      text_lang,
      ref_audio_path,
      prompt_text: promptContext.promptText,
      prompt_lang: promptContext.promptLang,
      aux_ref_audio_paths,
      top_k,
      top_p,
      temperature,
      repetition_penalty,
      speed_factor,
      seed,
      quality_preset: inferenceOptions.qualityPreset,
      ...inferenceOptions.synthParams,
      max_chunk_length: inferenceOptions.chunkOptions.maxChunkLength,
      max_sentences_per_chunk: inferenceOptions.chunkOptions.maxSentencesPerChunk,
      chunk_join_pause_ms: inferenceOptions.chunkOptions.chunkJoinPauseMs,
      retry_count: inferenceOptions.chunkOptions.retryCount,
      auto_transcribed_prompt: promptContext.autoFilled,
    },
  });
  sseManager.prepareSession(sessionId);
  res.json({ sessionId });

  // Wait for the SSE client to connect, then start streaming synthesis
  sseManager.waitForClient(sessionId).then(() => {
    synthesizeLongTextStreaming(sessionId, {
      text,
      text_lang,
      ref_audio_path,
      prompt_text: promptContext.promptText,
      prompt_lang: promptContext.promptLang,
      aux_ref_audio_paths,
      top_k,
      top_p,
      temperature,
      repetition_penalty,
      speed_factor,
      seed,
      ...inferenceOptions.synthParams,
    }, inferenceOptions.chunkOptions);
  }).catch((err) => {
    console.error(`[inference/generate] SSE client timeout for ${sessionId}:`, err.message);
  });
});

router.get('/inference/progress/:sessionId', (req, res) => {
  sseManager.addClient(req.params.sessionId, res);
});

router.get('/inference/result/:sessionId', (req, res) => {
  const finalPath = getSessionFinalPath(req.params.sessionId);
  if (!fs.existsSync(finalPath)) {
    return res.status(404).json({ error: 'Result not ready or session not found' });
  }

  const stat = fs.statSync(finalPath);
  res.set({
    'Content-Type': 'audio/wav',
    'Content-Length': stat.size,
  });
  fs.createReadStream(finalPath).pipe(res);
});

router.get('/inference/current', (_req, res) => {
  res.json(inferenceState.getState());
});

router.post('/inference/cancel', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  const cancelled = cancelSession(sessionId);
  if (cancelled) {
    inferenceState.setError('Generation cancelled by user', 'cancelled');
  }
  res.json({ cancelled });
});

router.post('/inference/stop', (_req, res) => {
  inferenceServer.stop();
  res.json({ message: 'Inference server stopped' });
});

// POST /api/transcribe - auto-transcribe reference audio
router.post('/transcribe', async (req, res) => {
  const configError = getConfigError({ requirePython: true });
  if (configError) {
    return res.status(503).json({ error: configError });
  }

  const { filePath, language = 'auto' } = req.body;
  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  const absolutePath = path.resolve(GPT_SOVITS_ROOT, filePath);
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ error: 'Audio file not found' });
  }

  try {
    const result = await transcribeReferenceAudio(filePath, { language, model: 'medium' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/inference/status', (_req, res) => {
  const configError = getConfigError({ requirePython: true });
  res.json({
    ready: !configError && inferenceServer.isReady(),
    error: configError,
    loaded: inferenceServer.getLoadedWeights(),
  });
});

// ── Training audio browser endpoints ──

router.get('/training-audio/file/:expName/:filename', (req, res) => {
  const { expName, filename } = req.params;
  if (expName.includes('..') || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const filePath = path.join(DATA_ROOT, expName, 'denoised', filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const stat = fs.statSync(filePath);
  res.set({
    'Content-Type': 'audio/wav',
    'Content-Length': stat.size,
  });
  fs.createReadStream(filePath).pipe(res);
});

router.get('/ref-audio', (req, res) => {
  const filePath = String(req.query.filePath || '');
  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  const resolvedPath = path.resolve(GPT_SOVITS_ROOT, filePath);
  const allowedDir = path.resolve(GPT_SOVITS_ROOT, 'TEMP', 'ref_audio');
  if (!resolvedPath.startsWith(allowedDir)) {
    return res.status(400).json({ error: 'Invalid reference audio path' });
  }
  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'Reference audio not found' });
  }

  const stat = fs.statSync(resolvedPath);
  res.type(path.extname(resolvedPath));
  res.set({
    'Content-Length': stat.size,
  });
  fs.createReadStream(resolvedPath).pipe(res);
});

router.get('/training-audio/:expName', (req, res) => {
  const { expName } = req.params;
  if (expName.includes('..')) {
    return res.status(400).json({ error: 'Invalid experiment name' });
  }

  const denoisedDir = path.join(DATA_ROOT, expName, 'denoised');
  if (!fs.existsSync(denoisedDir)) {
    return res.json({ expName, files: [] });
  }

  // Parse ASR transcripts from denoised.list
  const asrPath = path.join(DATA_ROOT, expName, 'asr', 'denoised.list');
  const transcriptMap = new Map();
  if (fs.existsSync(asrPath)) {
    const lines = fs.readFileSync(asrPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      // Format: abs_path|label|LANG|transcript
      const parts = line.split('|');
      if (parts.length >= 4) {
        const absPath = parts[0];
        const lang = parts[2];
        const transcript = parts.slice(3).join('|');
        const fname = path.basename(absPath);
        transcriptMap.set(fname, { transcript, lang });
      }
    }
  }

  try {
    const wavFiles = fs.readdirSync(denoisedDir).filter(f => f.endsWith('.wav')).sort();
    const files = wavFiles.map(filename => {
      const info = transcriptMap.get(filename) || {};
      return {
        filename,
        path: path.join(denoisedDir, filename),
        transcript: info.transcript || '',
        lang: info.lang || '',
      };
    });
    res.json({ expName, files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
