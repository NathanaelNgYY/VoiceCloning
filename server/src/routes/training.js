import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sseManager } from '../services/sseManager.js';
import { processManager } from '../services/processManager.js';
import { runPipeline, STEPS } from '../services/pipeline.js';
import { getConfigError, isS3Mode, S3_BUCKET, S3_PREFIX } from '../config.js';
import { trainingState } from '../services/trainingState.js';
import { isSafePathSegment } from '../utils/paths.js';

const router = Router();

const sessions = new Map();

router.post('/train', async (req, res) => {
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
  if (!isSafePathSegment(expName)) {
    return res.status(400).json({ error: 'expName may only contain letters, numbers, dots, dashes, and underscores' });
  }

  if (isS3Mode()) {
    try {
      const { gpuWorkerClient } = await import('../services/gpuWorkerClient.js');

      const sessionId = uuidv4();
      sessions.set(sessionId, { expName, startedAt: Date.now() });
      trainingState.resetForNewSession({ sessionId, expName });
      sseManager.prepareSession(sessionId);

      // Start training on GPU Worker
      const workerSessionId = await gpuWorkerClient.startTraining({
        expName,
        s3Bucket: S3_BUCKET,
        s3Prefix: S3_PREFIX,
        config: {
          batchSize,
          sovitsEpochs,
          gptEpochs,
          sovitsSaveEvery,
          gptSaveEvery,
          asrLanguage,
          asrModel,
        },
      });

      res.json({ sessionId, steps: STEPS });

      // Wait for SSE client, then relay GPU Worker events
      sseManager.waitForClient(sessionId).then(() => {
        trainingState.setStatus('running');
        return gpuWorkerClient.relayProgress(workerSessionId, sessionId, sseManager, trainingState);
      }).catch((err) => {
        trainingState.setError(err.message || 'Failed to connect to GPU Worker');
        sseManager.send(sessionId, 'error', {
          message: err.message || 'Failed to connect to GPU Worker',
        });
      }).finally(() => {
        sessions.delete(sessionId);
      });

      return;
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode — original behavior
  const configError = getConfigError({ requirePython: true });
  if (configError) {
    return res.status(503).json({ error: configError });
  }

  if (sessions.size > 0 || processManager.hasRunningProcesses()) {
    return res.status(409).json({ error: 'A training pipeline is already running on this instance' });
  }

  const sessionId = uuidv4();
  sessions.set(sessionId, { expName, startedAt: Date.now() });
  trainingState.resetForNewSession({ sessionId, expName });
  sseManager.prepareSession(sessionId);

  sseManager.waitForClient(sessionId).then(() => {
    trainingState.setStatus('running');
    return runPipeline(sessionId, {
      expName,
      batchSize,
      sovitsEpochs,
      gptEpochs,
      sovitsSaveEvery,
      gptSaveEvery,
      asrLanguage,
      asrModel,
    });
  }).catch((err) => {
    trainingState.setError(err.message || 'Pipeline failed to start');
    sseManager.send(sessionId, 'error', {
      message: err.message || 'Pipeline failed to start',
    });
  }).finally(() => {
    sessions.delete(sessionId);
  });

  res.json({ sessionId, steps: STEPS });
});

router.get('/train/current', (_req, res) => {
  res.json(trainingState.getState());
});

router.get('/train/status/:sessionId', (req, res) => {
  sseManager.addClient(req.params.sessionId, res);
});

router.post('/train/stop', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  if (isS3Mode()) {
    try {
      const { gpuWorkerClient } = await import('../services/gpuWorkerClient.js');
      await gpuWorkerClient.stopTraining(sessionId);
      trainingState.setStatus('stopped');
      sseManager.send(sessionId, 'error', { message: 'Training stopped by user' });
      sessions.delete(sessionId);
      return res.json({ message: 'Training stopped' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode
  const killed = processManager.kill(sessionId);
  if (killed) {
    trainingState.setStatus('stopped');
    sseManager.send(sessionId, 'error', { message: 'Training stopped by user' });
    sessions.delete(sessionId);
    res.json({ message: 'Training stopped' });
  } else {
    res.status(404).json({ error: 'No running process found for this session' });
  }
});

export default router;
