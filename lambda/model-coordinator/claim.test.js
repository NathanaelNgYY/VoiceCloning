import assert from 'node:assert/strict';
import test from 'node:test';
import { bootAssignmentClaimable } from './index.js';

const now = 1_000_000;
const pending = (overrides = {}) => ({
  entity: 'PENDING',
  synthesisBody: { voice_model: { gptRef: 'gpt', sovitsRef: 'sovits' } },
  requestedAt: now - 1_000,
  ...overrides,
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
