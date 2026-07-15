const GPU_READY_CACHE_KEY = 'voice-cloning:gpu-ready';
const DEFAULT_MAX_AGE_MS = 2 * 60 * 1000;

export function readCachedGpuReadyStatus({
  storage = globalThis.localStorage,
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  try {
    const parsed = JSON.parse(storage?.getItem(GPU_READY_CACHE_KEY) || 'null');
    if (!parsed?.status?.workerReady) return null;
    if (!Number.isFinite(parsed.savedAt) || now - parsed.savedAt > maxAgeMs) return null;
    return parsed.status;
  } catch {
    return null;
  }
}

export function cacheGpuReadyStatus(status, {
  storage = globalThis.localStorage,
  now = Date.now(),
} = {}) {
  try {
    if (status?.workerReady) {
      storage?.setItem(GPU_READY_CACHE_KEY, JSON.stringify({ status, savedAt: now }));
    } else {
      storage?.removeItem(GPU_READY_CACHE_KEY);
    }
  } catch {
    // Storage can be disabled/private; readiness still works from the network.
  }
}

