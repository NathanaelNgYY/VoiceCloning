import { Router } from 'express';
import { activityState, buildActivityStatus } from '../services/activityState.js';
import { inferenceState } from '../services/inferenceState.js';
import { trainingState } from '../services/trainingState.js';

const router = Router();

router.get('/activity/status', (_req, res) => {
  const training = trainingState.getState();
  const inference = inferenceState.getState();

  res.json(buildActivityStatus({
    lastActivityAt: activityState.getLastActivityAt(),
    trainingStatus: training.status,
    inferenceStatus: inference.status,
  }));
});

export default router;
