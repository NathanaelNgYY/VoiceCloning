const BUSY_TRAINING_STATUSES = new Set(['waiting', 'running']);
const BUSY_INFERENCE_STATUSES = new Set(['waiting', 'generating']);

class ActivityState {
  constructor() {
    this.lastActivityAt = Date.now();
  }

  mark(now = Date.now()) {
    this.lastActivityAt = now;
  }

  getLastActivityAt() {
    return this.lastActivityAt;
  }
}

export function buildActivityStatus({
  lastActivityAt,
  now = Date.now(),
  trainingStatus = 'idle',
  inferenceStatus = 'idle',
} = {}) {
  const busy = BUSY_TRAINING_STATUSES.has(trainingStatus)
    || BUSY_INFERENCE_STATUSES.has(inferenceStatus);
  const safeLastActivityAt = Number.isFinite(lastActivityAt) ? lastActivityAt : now;

  return {
    busy,
    lastActivityAt: safeLastActivityAt,
    idleMs: Math.max(0, now - safeLastActivityAt),
    trainingStatus,
    inferenceStatus,
  };
}

export const activityState = new ActivityState();
