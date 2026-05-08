import { Router } from 'express';
import { buildActivityStatus, refreshActivityWhileBusy } from '../services/activityState.js';
import { inferenceState } from '../services/inferenceState.js';
import { hasActiveInferenceSession } from '../services/longTextInference.js';
import { processManager } from '../services/processManager.js';
import { trainingState } from '../services/trainingState.js';

const router = Router();

router.get('/activity/status', (_req, res) => {
  const training = trainingState.getState();
  const inference = inferenceState.getState();
  const trainingActive = processManager.hasRunningProcesses();
  const inferenceActive = hasActiveInferenceSession(inference.sessionId);
  const now = Date.now();

  res.json(buildActivityStatus({
    lastActivityAt: refreshActivityWhileBusy({
      trainingActive,
      inferenceActive,
      now,
    }),
    now,
    trainingStatus: training.status,
    inferenceStatus: inference.status,
    trainingActive,
    inferenceActive,
  }));
});

export default router;
