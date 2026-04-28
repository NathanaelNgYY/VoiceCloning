import fs from 'fs';
import { Router } from 'express';
import { inferenceServer } from '../services/inferenceServer.js';

const router = Router();

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

    const audioBuffer = await inferenceServer.synthesize(req.body);
    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': audioBuffer.length,
    });
    res.send(audioBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
