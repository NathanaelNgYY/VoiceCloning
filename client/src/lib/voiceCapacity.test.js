import assert from 'node:assert/strict';
import test from 'node:test';

import {
  voiceCapacityBlocksConversation,
  voiceCapacityNotice,
} from './voiceCapacity.js';

test('a missing model blocks conversation and gives the truthful fifteen-minute alternative', () => {
  const capacity = { state: 'STARTING', canStartConversation: false, retryAfterSeconds: 900 };
  assert.equal(voiceCapacityBlocksConversation(capacity), true);
  assert.match(voiceCapacityNotice(capacity), /up to 15 minutes/i);
  assert.match(voiceCapacityNotice(capacity), /another lecture/i);
});

test('a busy resident model remains usable while background capacity starts', () => {
  const capacity = { state: 'BUSY_STARTING', canStartConversation: true };
  assert.equal(voiceCapacityBlocksConversation(capacity), false);
  assert.match(voiceCapacityNotice(capacity), /continue/i);
  assert.match(voiceCapacityNotice(capacity), /background/i);
});

test('one remaining slot warns without launching capacity during page preflight', () => {
  const capacity = { state: 'READY', canStartConversation: true, capacityTight: true };
  assert.equal(voiceCapacityBlocksConversation(capacity), false);
  assert.match(voiceCapacityNotice(capacity), /only one slot remains/i);
  assert.match(voiceCapacityNotice(capacity), /if your request fills it/i);
});

test('a successful request can report the background scale-out on the next capacity poll', () => {
  const capacity = { state: 'READY_SCALING', canStartConversation: true };
  assert.equal(voiceCapacityBlocksConversation(capacity), false);
  assert.match(voiceCapacityNotice(capacity), /another GPU is starting/i);
});
