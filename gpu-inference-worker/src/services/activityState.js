const BUSY_TRAINING_STATUSES = new Set(['waiting', 'running']);
const BUSY_INFERENCE_STATUSES = new Set(['waiting', 'generating']);
function isBusyStatus({
  trainingStatus = 'idle',
  inferenceStatus = 'idle',
  trainingActive,
  inferenceActive,
} = {}) {
  if (typeof trainingActive === 'boolean' || typeof inferenceActive === 'boolean') {
    return Boolean(trainingActive || inferenceActive);
  }

  return BUSY_TRAINING_STATUSES.has(trainingStatus)
    || BUSY_INFERENCE_STATUSES.has(inferenceStatus);
}

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
  trainingActive,
  inferenceActive,
} = {}) {
  const busy = isBusyStatus({
    trainingStatus,
    inferenceStatus,
    trainingActive,
    inferenceActive,
  });
  const safeLastActivityAt = Number.isFinite(lastActivityAt) ? lastActivityAt : now;

  return {
    busy,
    lastActivityAt: safeLastActivityAt,
    idleMs: Math.max(0, now - safeLastActivityAt),
    trainingStatus,
    inferenceStatus,
    trainingActive: Boolean(trainingActive),
    inferenceActive: Boolean(inferenceActive),
  };
}

export function refreshActivityWhileBusy({
  state = activityState,
  trainingActive = false,
  inferenceActive = false,
  now = Date.now(),
} = {}) {
  if (trainingActive || inferenceActive) {
    state.mark(now);
  }
  return state.getLastActivityAt();
}

export function shouldTrackRequestActivity() {
  return false;
}

export const activityState = new ActivityState();
