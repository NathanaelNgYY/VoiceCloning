import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRealtimeSessionUpdate } from './openaiRealtimeEvents.js';

test('buildRealtimeSessionUpdate uses selected Chinese for replies and transcription', () => {
  const update = buildRealtimeSessionUpdate({
    language: 'zh',
    systemPrompt: 'You are a casual, helpful assistant. Always respond only in English.',
  });

  assert.equal(update.session.audio.input.transcription.language, 'zh');
  assert.match(update.session.instructions, /only in Chinese/i);
  assert.doesNotMatch(update.session.instructions, /only in English/i);
});
