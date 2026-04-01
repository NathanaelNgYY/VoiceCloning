import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sseManager } from '../services/sseManager.js';
import { processManager } from '../services/processManager.js';
import { runPipeline, STEPS } from '../services/pipeline.js';

const router = Router();

// Active pipeline sessions
const sessions = new Map();

// POST /api/train - start the full pipeline
router.post('/train', (req, res) => {
  const {
    expName,
    batchSize,
    sovitsEpochs,
    gptEpochs,
    sovitsSaveEvery,
    gptSaveEvery,
    asrLanguage,
    asrModel,
  } = req.body;

  if (!expName) {
    return res.status(400).json({ error: 'expName is required' });
  }

  const sessionId = uuidv4();
  sessions.set(sessionId, { expName, startedAt: Date.now() });

  // Run pipeline in background (don't await)
  runPipeline(sessionId, {
    expName,
    batchSize,
    sovitsEpochs,
    gptEpochs,
    sovitsSaveEvery,
    gptSaveEvery,
    asrLanguage,
    asrModel,
  }).finally(() => {
    sessions.delete(sessionId);
  });

  res.json({ sessionId, steps: STEPS });
});

// GET /api/train/status/:sessionId - SSE stream
router.get('/train/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  sseManager.addClient(sessionId, res);
});

// POST /api/train/stop - stop current pipeline
router.post('/train/stop', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const killed = processManager.kill(sessionId);
  if (killed) {
    sseManager.send(sessionId, 'error', { message: 'Training stopped by user' });
    sessions.delete(sessionId);
    res.json({ message: 'Training stopped' });
  } else {
    res.status(404).json({ error: 'No running process found for this session' });
  }
});

export default router;
