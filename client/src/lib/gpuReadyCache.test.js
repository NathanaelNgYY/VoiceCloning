import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheGpuReadyStatus, readCachedGpuReadyStatus } from './gpuReadyCache.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('recent GPU-ready state is restored without blocking the returning page', () => {
  const storage = memoryStorage();
  const status = { configured: true, state: 'running', workerReady: true };
  cacheGpuReadyStatus(status, { storage, now: 1000 });
  assert.deepEqual(readCachedGpuReadyStatus({ storage, now: 2000 }), status);
});

test('stale or no-longer-ready GPU state is never restored', () => {
  const storage = memoryStorage();
  cacheGpuReadyStatus(
    { configured: true, state: 'running', workerReady: true },
    { storage, now: 1000 },
  );
  assert.equal(readCachedGpuReadyStatus({ storage, now: 200000, maxAgeMs: 1000 }), null);

  cacheGpuReadyStatus(
    { configured: true, state: 'stopped', workerReady: false },
    { storage, now: 200001 },
  );
  assert.equal(readCachedGpuReadyStatus({ storage, now: 200002 }), null);
});

