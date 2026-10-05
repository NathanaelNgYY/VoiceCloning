import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSendLiveMicAudio, shouldTriggerLiveBargeIn, createLiveSynthesisSnapshot, buildLiveSentenceParams } from '../hooks/liveConversation.js';
import { mcSessionStatus } from './mcSession.js';

test('turn mode keeps the mic available but sends audio only on the human turn', () => {
  for (const phase of ['idle', 'connecting', 'thinking', 'speaking', 'stopping']) {
    assert.equal(shouldSendLiveMicAudio({ phase, micInputEnabled: true, listeningMode: 'turns' }), false, phase);
    assert.equal(shouldTriggerLiveBargeIn({ phase, micInputEnabled: true, listeningMode: 'turns', rms: 1 }), false, phase);
  }
  assert.equal(shouldSendLiveMicAudio({ phase: 'listening', micInputEnabled: true, listeningMode: 'turns' }), true);
  assert.equal(shouldSendLiveMicAudio({ phase: 'listening', micInputEnabled: false, listeningMode: 'turns' }), false);
});

test('continuous mode preserves input during thinking and interruption during playback', () => {
  assert.equal(shouldSendLiveMicAudio({ phase: 'thinking', micInputEnabled: true }), true);
  assert.equal(shouldTriggerLiveBargeIn({ phase: 'speaking', micInputEnabled: true, rms: 0.08 }), true);
  assert.equal(shouldTriggerLiveBargeIn({ phase: 'speaking', micInputEnabled: false, rms: 1 }), false);
});

test('MC synthesis pins Dean through the shared Fast sentence request', () => {
  const snapshot = createLiveSynthesisSnapshot({ refParams: {}, voiceProfileId: 'deanvoice-v1' });
  const request = buildLiveSentenceParams('Welcome to our event.', snapshot.refParams, 'en', { skipVerify: true });
  assert.equal(request.voiceProfileId, 'deanvoice-v1');
  assert.equal(request.skip_verify, true);
  assert.equal(snapshot.engine, 'fast');
  assert.equal(request.speed_factor, undefined, 'saved voice settings are resolved by the existing backend');
});

test('MC status distinguishes mute, human turn, and AI turn', () => {
  assert.equal(mcSessionStatus({ phase: 'listening', micEnabled: false }), 'Microphone muted');
  assert.equal(mcSessionStatus({ phase: 'listening', micEnabled: true }), 'Listening to you');
  assert.match(mcSessionStatus({ phase: 'speaking', listeningMode: 'turns' }), /your turn next/);
});
