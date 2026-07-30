import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeVoiceKey, resolveInitialVoiceKey } from './chatbotVoice.js';

test('normalizeVoiceKey lowercases and strips separators', () => {
  assert.equal(normalizeVoiceKey('DeanVoice'), 'deanvoice');
  assert.equal(normalizeVoiceKey('Dean Voice'), 'deanvoice');
  assert.equal(normalizeVoiceKey('dean_voice-01'), 'deanvoice01');
  assert.equal(normalizeVoiceKey(''), '');
  assert.equal(normalizeVoiceKey(null), '');
});

test('resolveInitialVoiceKey prefers ?voice= over env', () => {
  assert.equal(
    resolveInitialVoiceKey({ search: '?voice=SomeOne', envVoiceId: 'DeanVoice' }),
    'someone',
  );
});

test('resolveInitialVoiceKey falls back to env when no url param', () => {
  assert.equal(resolveInitialVoiceKey({ search: '', envVoiceId: 'DeanVoice' }), 'deanvoice');
});

test('resolveInitialVoiceKey returns empty when neither provided', () => {
  assert.equal(resolveInitialVoiceKey({ search: '', envVoiceId: '' }), '');
  assert.equal(resolveInitialVoiceKey(), '');
});
