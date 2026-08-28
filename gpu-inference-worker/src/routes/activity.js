import { Router } from 'express';
import { buildActivityStatus, refreshActivityWhileBusy } from '../services/activityState.js';
import { inferenceState } from '../services/inferenceState.js';
import { hasActiveInferenceSession } from '../services/longTextInference.js';

const router = Router();

function sendActivityStatus(_req, res) {
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
}

router.get('/activity/status', sendActivityStatus);
router.get('/inference/activity/status', sendActivityStatus);
// Dev can add a second manual inference target while the original EC2 keeps its
// own activity-based shutdown. The ALB routes this exact alias to a target group
// containing only the original instance, avoiding a random fleet member's idle
// state from stopping the wrong EC2.
router.get('/fixed-inference/activity/status', sendActivityStatus);

export default router;
