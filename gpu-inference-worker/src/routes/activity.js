import { Router } from 'express';
import { buildActivityStatus, refreshActivityWhileBusy } from '../services/activityState.js';
import { inferenceState } from '../services/inferenceState.js';
import { hasActiveInferenceSession } from '../services/longTextInference.js';

const router = Router();

router.get('/activity/status', (_req, res) => {
  const inference = inferenceState.getState();
  const inferenceActive = hasActiveInferenceSession(inference.sessionId);
  const now = Date.now();

  res.json(buildActivityStatus({
    lastActivityAt: refreshActivityWhileBusy({
      inferenceActive,
      now,
    }),
    now,
    inferenceStatus: inference.status,
    inferenceActive,
  }));
});

export default router;
