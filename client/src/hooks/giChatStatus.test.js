import test from 'node:test';
import assert from 'node:assert/strict';

import { isResponseBusy, isVoiceActive, toGiStatus } from './giChatStatus.js';

test('toGiStatus passes through the statuses the components already know', () => {
  assert.equal(toGiStatus('idle'), 'idle');
  assert.equal(toGiStatus('listening'), 'listening');
  assert.equal(toGiStatus('thinking'), 'thinking');
  assert.equal(toGiStatus('speaking'), 'speaking');
});

test('toGiStatus treats a per-message status as an unknown phase', () => {
  // 'generating_voice' is a message status, never a phase — it must not be
  // mistaken for one here.
  assert.equal(toGiStatus('generating_voice'), 'idle');
});

test('toGiStatus maps the connecting phase to connecting', () => {
  assert.equal(toGiStatus('connecting'), 'connecting');
});

test('toGiStatus maps the stopping phase to idle', () => {
  assert.equal(toGiStatus('stopping'), 'idle');
});

test('toGiStatus falls back to idle for unknown phases', () => {
  assert.equal(toGiStatus(''), 'idle');
  assert.equal(toGiStatus(undefined), 'idle');
  assert.equal(toGiStatus('something-new'), 'idle');
});

test('toGiStatus reports error when an error is present and the engine is idle', () => {
  assert.equal(toGiStatus('idle', { hasError: true }), 'error');
});

test('toGiStatus prefers the live phase over a stale error', () => {
  assert.equal(toGiStatus('listening', { hasError: true }), 'listening');
});

test('isResponseBusy is true only while the assistant is producing a reply', () => {
  assert.equal(isResponseBusy('thinking'), true);
  assert.equal(isResponseBusy('speaking'), true);
  assert.equal(isResponseBusy('listening'), false);
  assert.equal(isResponseBusy('idle'), false);
  assert.equal(isResponseBusy('connecting'), false);
});

test('isVoiceActive is true for every non-idle phase', () => {
  assert.equal(isVoiceActive('idle'), false);
  assert.equal(isVoiceActive('listening'), true);
  assert.equal(isVoiceActive('speaking'), true);
});
