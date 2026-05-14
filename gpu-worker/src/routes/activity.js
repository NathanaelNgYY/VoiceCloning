import { Router } from 'express';
import { buildActivityStatus, refreshActivityWhileBusy } from '../services/activityState.js';
import { processManager } from '../services/processManager.js';
import { trainingState } from '../services/trainingState.js';

const router = Router();

router.get('/activity/status', (_req, res) => {
  const training = trainingState.getState();
  const trainingActive = processManager.hasRunningProcesses();
  const now = Date.now();

  res.json(buildActivityStatus({
    lastActivityAt: refreshActivityWhileBusy({
      trainingActive,
      now,
    }),
    now,
    trainingStatus: training.status,
    trainingActive,
  }));
});

export default router;
