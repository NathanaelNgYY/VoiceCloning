import assert from 'node:assert/strict';
import test from 'node:test';
import { bootAssignmentClaimable, pendingWorkerMatchesBoot } from './index.js';

const now = 1_000_000;
const pending = (overrides = {}) => ({
  entity: 'PENDING',
  coordinatorScope: 'vcs-staging-gpu-inference',
  synthesisBody: { voice_model: { gptRef: 'gpt', sovitsRef: 'sovits' } },
  requestedAt: now - 1_000,
  ...overrides,
});

test('a pending Staging assignment is invisible to the Dev coordinator scope', () => {
  assert.equal(bootAssignmentClaimable(pending(), 'i-dev', now, 'dev'), false);
});

test('an old matching worker cannot clear a pending overflow launch', () => {
  assert.equal(pendingWorkerMatchesBoot(pending({
    claimedBy: undefined,
  }), {
    instanceId: 'i-existing',
    firstSeenAt: now - 600_000,
    reachable: true,
    state: 'READY',
    modelKey: 'model-a',
    active: 1,
    queued: 0,
    maxSlots: 2,
  }, 'model-a'), false);
});

test('the claimed new worker may satisfy and clear its pending overflow launch', () => {
  assert.equal(pendingWorkerMatchesBoot(pending({
    claimedBy: 'i-new',
  }), {
    instanceId: 'i-new',
    firstSeenAt: now + 1,
    reachable: true,
    state: 'READY',
    modelKey: 'model-a',
    active: 0,
    queued: 0,
    maxSlots: 2,
  }, 'model-a'), true);
});

test('the same booting instance can reclaim its assignment after a service restart', () => {
  assert.equal(bootAssignmentClaimable(pending({
    claimedBy: 'i-canary',
    claimExpiresAt: now + 60_000,
  }), 'i-canary', now), true);
});

test('a different instance cannot steal a live boot assignment claim', () => {
  assert.equal(bootAssignmentClaimable(pending({
    claimedBy: 'i-original',
    claimExpiresAt: now + 60_000,
  }), 'i-other', now), false);
});

test('a different instance may claim after the prior lease expires', () => {
  assert.equal(bootAssignmentClaimable(pending({
    claimedBy: 'i-original',
    claimExpiresAt: now - 1,
  }), 'i-other', now), true);
});
