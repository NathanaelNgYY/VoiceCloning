import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { WEIGHT_DIRS } from '../config.js';
import { inferenceServer } from '../services/inferenceServer.js';

const router = Router();

// GET /api/models - list available model weights
router.get('/models', (_req, res) => {
  try {
    const gptFiles = fs.existsSync(WEIGHT_DIRS.gpt)
      ? fs.readdirSync(WEIGHT_DIRS.gpt).filter(f => f.endsWith('.ckpt'))
      : [];

    const sovitsFiles = fs.existsSync(WEIGHT_DIRS.sovits)
      ? fs.readdirSync(WEIGHT_DIRS.sovits).filter(f => f.endsWith('.pth'))
      : [];

    res.json({
      gpt: gptFiles.map(f => ({
        name: f,
        path: path.join(WEIGHT_DIRS.gpt, f),
      })),
      sovits: sovitsFiles.map(f => ({
        name: f,
        path: path.join(WEIGHT_DIRS.sovits, f),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/models/select - load weights into inference server
router.post('/models/select', async (req, res) => {
  const { gptPath, sovitsPath } = req.body;

  try {
    // Start inference server if not running
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

// POST /api/inference - synthesize speech
router.post('/inference', async (req, res) => {
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

    const audioBuffer = await inferenceServer.synthesize({
      text,
      text_lang,
      ref_audio_path,
      prompt_text,
      prompt_lang,
      top_k,
      top_p,
      temperature,
      speed_factor,
      text_split_method: 'cut5',
      batch_size: 1,
      streaming_mode: false,
    });

    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': audioBuffer.length,
    });
    res.send(audioBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inference/stop - stop inference server
router.post('/inference/stop', (_req, res) => {
  inferenceServer.stop();
  res.json({ message: 'Inference server stopped' });
});

// GET /api/inference/status - check inference server status
router.get('/inference/status', (_req, res) => {
  res.json({ ready: inferenceServer.isReady() });
});

export default router;
