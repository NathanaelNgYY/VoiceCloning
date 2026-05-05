import test from 'node:test';
import assert from 'node:assert/strict';
import { extractErrorMessage } from './inferenceServer.js';

test('extractErrorMessage prefers GPT-SoVITS exception details over generic message', () => {
  const message = extractErrorMessage({
    message: 'tts failed',
    Exception: 'reference.wav not exists',
  }, 'fallback');

  assert.equal(message, 'reference.wav not exists');
});
