import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeEventMapper, buildRealtimeSessionUpdate } from './openaiRealtimeEvents.js';

test('buildRealtimeSessionUpdate uses selected Chinese for replies and transcription', () => {
  const update = buildRealtimeSessionUpdate({
    language: 'zh',
    systemPrompt: 'You are a casual, helpful assistant. Always respond only in English.',
  });

  assert.equal(update.session.audio.input.transcription.language, 'zh');
  assert.match(update.session.instructions, /only in Chinese/i);
  assert.match(update.session.instructions, /Do not include English words/i);
  assert.doesNotMatch(update.session.instructions, /only in English/i);
});

test('RealtimeEventMapper leaves Chinese-mode assistant numbers as digits', () => {
  const mapper = new RealtimeEventMapper({ language: 'zh' });
  const events = mapper.map({
    type: 'response.text.done',
    response_id: 'response-1',
    item_id: 'item-1',
    content_index: 0,
    text: '气温30度，湿度70%。',
  });

  assert.equal(events[0].text, '气温30度，湿度70%。');
  assert.doesNotMatch(events[0].text, /thirty|seventy/i);
});

test('RealtimeEventMapper keeps English-mode assistant number preprocessing', () => {
  const mapper = new RealtimeEventMapper({ language: 'en' });
  const events = mapper.map({
    type: 'response.text.done',
    response_id: 'response-1',
    item_id: 'item-1',
    content_index: 0,
    text: 'It is 30 degrees.',
  });

  assert.equal(events[0].text, 'It is thirty degrees.');
});

test('buildRealtimeSessionUpdate always appends prosody guidance for the default prompt', () => {
  const update = buildRealtimeSessionUpdate({ language: 'en' });
  assert.match(
    update.session.instructions,
    /End every sentence with a period, question mark, or exclamation mark\./,
  );
});

test('buildRealtimeSessionUpdate appends prosody guidance even for a custom prompt that lacks it', () => {
  const update = buildRealtimeSessionUpdate({
    language: 'en',
    systemPrompt: 'You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English.',
  });

  // Custom persona text is preserved
  assert.match(update.session.instructions, /casual, helpful assistant/);
  // Language instruction still present
  assert.match(update.session.instructions, /Always respond only in English/);
  // Prosody guidance was appended
  assert.match(update.session.instructions, /em dashes/);
  assert.match(
    update.session.instructions,
    /End every sentence with a period, question mark, or exclamation mark\./,
  );
});

test('buildRealtimeSessionUpdate appends prosody guidance for the Chinese prompt too', () => {
  const update = buildRealtimeSessionUpdate({ language: 'zh' });
  assert.match(
    update.session.instructions,
    /End every sentence with a period, question mark, or exclamation mark\./,
  );
});
