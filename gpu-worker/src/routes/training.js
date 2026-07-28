import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sseManager } from '../services/sseManager.js';
import { processManager } from '../services/processManager.js';
import { runPipelineWithS3, STEPS } from '../services/pipeline.js';
import { trainingState } from '../services/trainingState.js';
import { activityState } from '../services/activityState.js';

const router = Router();
const sessions = new Map();
const pendingSessions = [];
const maxTrainingQueueDepth = Math.max(
  1,
  Math.min(100, Number.parseInt(process.env.TRAINING_MAX_QUEUE_DEPTH || '20', 10) || 20),
);
let activeSessionId = '';

async function runNextTrainingSession() {
  if (activeSessionId || pendingSessions.length === 0) return;
  const sessionId = pendingSessions.shift();
  const session = sessions.get(sessionId);
  if (!session) return runNextTrainingSession();

  activeSessionId = sessionId;
  session.status = 'waiting-for-client';
  trainingState.resetForNewSession({ sessionId, expName: session.expName });
  sseManager.send(sessionId, 'queue-start', {
    sessionId,
    queuedForMs: Date.now() - session.queuedAt,
  });

  try {
    await sseManager.waitForClient(sessionId);
    session.status = 'running';
    trainingState.setStatus('running');
    await runPipelineWithS3(sessionId, session.pipeline);
  } catch (err) {
    if (err.message === 'SSE client did not connect in time') {
      trainingState.clear();
      sseManager.clearSession(sessionId);
    } else {
      trainingState.setError(err.message || 'Pipeline failed');
      sseManager.send(sessionId, 'error', { message: err.message || 'Pipeline failed' });
    }
  } finally {
    sessions.delete(sessionId);
    activeSessionId = '';
    runNextTrainingSession();
  }
}

router.post('/train', (req, res) => {
  const { expName, email = '', config = {} } = req.body;

  if (!expName) {
    return res.status(400).json({ error: 'expName is required' });
  }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  if (pendingSessions.length >= maxTrainingQueueDepth) {
    return res.status(429).json({
      error: 'The training queue is full. Please retry later.',
      queueDepth: pendingSessions.length,
    });
  }

  const sessionId = uuidv4();
  const s3Prefix = `training/datasets/${expName}/raw/`;

  const queuedAt = Date.now();
  sessions.set(sessionId, {
    expName,
    email,
    queuedAt,
    status: 'queued',
    pipeline: {
      expName,
      email,
      s3Prefix,
      batchSize: config.batchSize,
      sovitsEpochs: config.sovitsEpochs,
      gptEpochs: config.gptEpochs,
      sovitsSaveEvery: config.sovitsSaveEvery,
      gptSaveEvery: config.gptSaveEvery,
      asrLanguage: config.asrLanguage,
      asrModel: config.asrModel,
      skipDenoise: config.skipDenoise,
      selectedReferences: config.selectedReferences,
      sourceDatasetStats: config.sourceDatasetStats,
    },
  });
  sseManager.prepareSession(sessionId);
  pendingSessions.push(sessionId);
  const queuePosition = pendingSessions.length + (activeSessionId ? 1 : 0);
  sseManager.send(sessionId, 'queued', {
    sessionId,
    queuePosition,
    queueDepth: pendingSessions.length,
  });

  res.json({ sessionId, steps: STEPS, queuePosition });
  runNextTrainingSession();
});

router.get('/train/progress/:sessionId', (req, res) => {
  sseManager.addClient(req.params.sessionId, res);
});

router.post('/train/stop', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  const pendingIndex = pendingSessions.indexOf(sessionId);
  if (pendingIndex >= 0) {
    pendingSessions.splice(pendingIndex, 1);
    sessions.delete(sessionId);
    sseManager.send(sessionId, 'error', { message: 'Queued training cancelled by user' });
    return res.json({ message: 'Queued training cancelled' });
  }
  const killed = processManager.kill(sessionId);
  if (killed) {
    activityState.mark();
    sseManager.send(sessionId, 'error', { message: 'Training stopped by user' });
  }
  trainingState.clear();
  sseManager.clearSession(sessionId);
  sessions.delete(sessionId);
  if (activeSessionId === sessionId) activeSessionId = '';
  runNextTrainingSession();
  res.json({ message: 'Training stopped' });
});

router.get('/train/current', (req, res) => {
  const requested = String(req.query?.sessionId || '').trim();
  const queued = requested ? sessions.get(requested) : null;
  if (queued && requested !== activeSessionId) {
    return res.json({
      sessionId: requested,
      expName: queued.expName,
      status: 'queued',
      queuePosition: pendingSessions.indexOf(requested) + 1,
      queueDepth: pendingSessions.length,
    });
  }
  res.json({
    ...trainingState.getState(),
    queueDepth: pendingSessions.length,
  });
});

export default router;
