import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Router } from 'express';
import { LOCAL_TEMP_ROOT } from '../config.js';
import { downloadFile } from '../services/s3Sync.js';
import { inferenceServer } from '../services/inferenceServer.js';
import {
  synthesizeLongText,
  synthesizeLongTextStreaming,
  cancelSession,
} from '../services/longTextInference.js';
import { inferenceState } from '../services/inferenceState.js';
import { sseManager } from '../services/sseManager.js';

const router = Router();

const refAudioCache = path.join(LOCAL_TEMP_ROOT, 'ref_audio_cache');

function cachePathForS3Key(s3Key) {
  const hash = crypto.createHash('sha1').update(s3Key).digest('hex').slice(0, 12);
  return path.join(refAudioCache, `${hash}_${path.basename(s3Key)}`);
}

async function resolveRefAudioPath(refPath) {
  if (!refPath || fs.existsSync(refPath)) {
    return refPath;
  }

  const localPath = cachePathForS3Key(refPath);
  if (!fs.existsSync(localPath)) {
    fs.mkdirSync(refAudioCache, { recursive: true });
    await downloadFile(refPath, localPath);
  }
  return localPath;
}

async function resolveRefAudioParams(params) {
  return {
    ...params,
    ref_audio_path: await resolveRefAudioPath(params.ref_audio_path),
    aux_ref_audio_paths: await Promise.all(
      (params.aux_ref_audio_paths || []).map((item) => resolveRefAudioPath(item)),
    ),
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

router.get('/inference/status', async (_req, res) => {
  try {
    const status = await inferenceServer.getStatus();
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

router.post('/inference/start', async (_req, res) => {
  try {
    const status = await inferenceServer.start();
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
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/inference/tts', async (req, res) => {
  try {
    const status = await inferenceServer.getStatus();
    if (!status.ready) {
      return res.status(503).json({ error: status.error || 'Inference server is not ready' });
    }

    const resolvedParams = await resolveRefAudioParams(req.body);
    const audioBuffer = await inferenceServer.synthesize(resolvedParams);
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

    const resolvedParams = await resolveRefAudioParams(params);
    const { audioBuffer, chunks } = await synthesizeLongText(resolvedParams, {
      maxChunkLength: 280,
      maxSentencesPerChunk: 3,
      chunkJoinPauseMs: 120,
      retryCount: 2,
    });

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
      return res.status(409).json({ error: 'Another generation is already running on this instance' });
    }

    const resolvedParams = await resolveRefAudioParams(params);
    const sessionId = crypto.randomUUID();
    inferenceState.resetForNewSession({ sessionId, params: resolvedParams });
    sseManager.prepareSession(sessionId);
    res.json({ sessionId });

    sseManager.waitForClient(sessionId).then(() => {
      synthesizeLongTextStreaming(sessionId, resolvedParams, {
        maxChunkLength: 280,
        maxSentencesPerChunk: 3,
        chunkJoinPauseMs: 120,
        retryCount: 2,
      });
    }).catch((err) => {
      console.error(`[inference/generate] SSE client timeout for ${sessionId}:`, err.message);
      inferenceState.setError(err.message);
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
  if (cancelled) {
    inferenceState.setError('Generation cancelled by user', 'cancelled');
  }
  res.json({ cancelled });
});

router.get('/inference/current', (_req, res) => {
  res.json(inferenceState.getState());
});

export default router;
