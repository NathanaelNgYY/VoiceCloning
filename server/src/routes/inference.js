import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { WEIGHT_DIRS, getConfigError } from '../config.js';
import { inferenceServer } from '../services/inferenceServer.js';
import { synthesizeLongText } from '../services/longTextInference.js';

const router = Router();

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

    res.json({ message: 'Models loaded successfully' });
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
    top_k = 5,
    top_p = 1,
    temperature = 1,
    speed_factor = 1.0,
    seed,
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

    const { audioBuffer, chunks } = await synthesizeLongText({
      text,
      text_lang,
      ref_audio_path,
      prompt_text,
      prompt_lang,
      top_k,
      top_p,
      temperature,
      speed_factor,
      seed,
    }, {
      maxChunkLength: 180,
      maxSentencesPerChunk: 3,
      chunkJoinPauseMs: 180,
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

router.post('/inference/stop', (_req, res) => {
  inferenceServer.stop();
  res.json({ message: 'Inference server stopped' });
});

router.get('/inference/status', (_req, res) => {
  const configError = getConfigError({ requirePython: true });
  res.json({ ready: !configError && inferenceServer.isReady(), error: configError });
});

export default router;