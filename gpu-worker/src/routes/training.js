import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sseManager } from '../services/sseManager.js';
import { processManager } from '../services/processManager.js';
import { runPipelineWithS3, STEPS } from '../services/pipeline.js';
import { trainingState } from '../services/trainingState.js';

const router = Router();
const sessions = new Map();

router.post('/train', (req, res) => {
  const { expName, config = {} } = req.body;

  if (!expName) {
    return res.status(400).json({ error: 'expName is required' });
  }
  if (sessions.size > 0 || processManager.hasRunningProcesses()) {
    return res.status(409).json({ error: 'A training pipeline is already running' });
  }

  const sessionId = uuidv4();
  const s3Prefix = `training/datasets/${expName}/raw/`;

  sessions.set(sessionId, { expName, startedAt: Date.now() });
  trainingState.resetForNewSession({ sessionId, expName });
  sseManager.prepareSession(sessionId);

  res.json({ sessionId, steps: STEPS });

  sseManager.waitForClient(sessionId).then(() => {
    trainingState.setStatus('running');
    return runPipelineWithS3(sessionId, {
      expName,
      s3Prefix,
      batchSize: config.batchSize,
      sovitsEpochs: config.sovitsEpochs,
      gptEpochs: config.gptEpochs,
      sovitsSaveEvery: config.sovitsSaveEvery,
      gptSaveEvery: config.gptSaveEvery,
      asrLanguage: config.asrLanguage,
      asrModel: config.asrModel,
    });
  }).catch((err) => {
    if (err.message === 'SSE client did not connect in time') {
      trainingState.clear();
      sseManager.clearSession(sessionId);
    } else {
      trainingState.setError(err.message || 'Pipeline failed');
      sseManager.send(sessionId, 'error', { message: err.message || 'Pipeline failed' });
    }
  }).finally(() => {
    sessions.delete(sessionId);
  });
});

router.get('/train/progress/:sessionId', (req, res) => {
  sseManager.addClient(req.params.sessionId, res);
});

router.post('/train/stop', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  const killed = processManager.kill(sessionId);
  if (killed) {
    trainingState.setStatus('stopped');
    sseManager.send(sessionId, 'error', { message: 'Training stopped by user' });
    sessions.delete(sessionId);
    res.json({ message: 'Training stopped' });
  } else {
    res.status(404).json({ error: 'No running process found' });
  }
});

router.get('/train/current', (_req, res) => {
  res.json(trainingState.getState());
});

export default router;
