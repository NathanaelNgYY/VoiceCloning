import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafePathSegment, sanitizeFilename } from './paths.js';

test('isSafePathSegment accepts only simple path segments', () => {
  assert.equal(isSafePathSegment('voice-model_01.2'), true);
  assert.equal(isSafePathSegment('../voice-model'), false);
  assert.equal(isSafePathSegment('voice/model'), false);
  assert.equal(isSafePathSegment(''), false);
});

test('sanitizeFilename preserves safe extension and replaces unsafe base characters', () => {
  assert.equal(sanitizeFilename('My Voice Clip!.wav', 'audio'), 'My_Voice_Clip.wav');
  assert.equal(sanitizeFilename('###.mp3', 'audio'), 'audio.mp3');
});
