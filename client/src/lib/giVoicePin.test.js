import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPinnedVoiceModel,
  matchesPinnedVoice,
  resolvePinnedVoiceKey,
} from './giVoicePin.js';

const DEAN = { displayName: 'DeanVoice', voiceProfileId: 'deanvoice-v1' };

test('resolvePinnedVoiceKey reads the gi env var', () => {
  assert.equal(
    resolvePinnedVoiceKey({ env: { VITE_GI_VOICE_PROFILE_ID: 'DeanVoice' } }),
    'deanvoice'
  );
});

test('resolvePinnedVoiceKey falls back to the kiosk env var', () => {
  assert.equal(
    resolvePinnedVoiceKey({ env: { VITE_CHATBOT_VOICE_PROFILE_ID: 'DeanVoice' } }),
    'deanvoice'
  );
});

test('resolvePinnedVoiceKey lets ?voice= win over env', () => {
  assert.equal(
    resolvePinnedVoiceKey({
      search: '?voice=theo',
      env: { VITE_GI_VOICE_PROFILE_ID: 'DeanVoice' },
    }),
    'theo'
  );
});

test('resolvePinnedVoiceKey ignores a blank ?voice=', () => {
  assert.equal(
    resolvePinnedVoiceKey({ search: '?voice=%20', env: { VITE_GI_VOICE_PROFILE_ID: 'DeanVoice' } }),
    'deanvoice'
  );
});

test('resolvePinnedVoiceKey returns empty when nothing is pinned', () => {
  assert.equal(resolvePinnedVoiceKey(), '');
});

test('matchesPinnedVoice accepts a match on displayName', () => {
  assert.equal(matchesPinnedVoice(DEAN, 'deanvoice'), true);
});

test('matchesPinnedVoice accepts a match on voiceProfileId', () => {
  // 'deanvoice-v1' normalizes to 'deanvoicev1' — the pin can be written either way.
  assert.equal(matchesPinnedVoice(DEAN, 'deanvoicev1'), true);
});

test('matchesPinnedVoice rejects a different active voice', () => {
  assert.equal(matchesPinnedVoice({ displayName: 'Obama', voiceProfileId: 'obama-v1' }, 'deanvoice'), false);
});

test('matchesPinnedVoice accepts anything when no pin is configured', () => {
  assert.equal(matchesPinnedVoice({ displayName: 'Obama' }, ''), true);
});

test('matchesPinnedVoice rejects a missing profile when a pin is set', () => {
  // No active profile at all must not read as "the pinned voice is ready".
  assert.equal(matchesPinnedVoice(null, 'deanvoice'), false);
});

test('buildPinnedVoiceModel freezes the exact GI profile revision', () => {
  assert.deepEqual(buildPinnedVoiceModel({
    voiceProfileId: 'deanvoice-v1',
    gptKey: 'models/user-models/gpt/dean.ckpt',
    sovitsKey: 'models/user-models/sovits/dean.pth',
    updatedAt: '2026-07-29T02:00:00.000Z',
  }), {
    voiceProfileId: 'deanvoice-v1',
    gptRef: 'models/user-models/gpt/dean.ckpt',
    sovitsRef: 'models/user-models/sovits/dean.pth',
    revision: '2026-07-29T02:00:00.000Z',
  });
});

test('buildPinnedVoiceModel rejects incomplete model pairs', () => {
  assert.equal(buildPinnedVoiceModel({ gptKey: 'dean.ckpt' }), null);
});
