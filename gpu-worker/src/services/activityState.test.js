import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityStatus } from './activityState.js';

test('buildActivityStatus reports idle duration when worker is not busy', () => {
  const status = buildActivityStatus({
    lastActivityAt: 1_000,
    now: 7_000,
    trainingStatus: 'idle',
    inferenceStatus: 'complete',
  });

  assert.equal(status.busy, false);
  assert.equal(status.idleMs, 6_000);
});

test('buildActivityStatus stays busy during training or generation', () => {
  assert.equal(buildActivityStatus({ trainingStatus: 'running' }).busy, true);
  assert.equal(buildActivityStatus({ inferenceStatus: 'generating' }).busy, true);
});
