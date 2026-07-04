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

test('buildRealtimeSessionUpdate pins transcription language without a leaky prompt', () => {
  const update = buildRealtimeSessionUpdate({ language: 'en' });

  assert.equal(update.session.audio.input.transcription.language, 'en');
  // No `prompt`: gpt-4o-mini-transcribe echoes it back as the transcript on
  // silence, which surfaced the prompt text in the user's own speech bubble.
  assert.equal(update.session.audio.input.transcription.prompt, undefined);
});

test('RealtimeEventMapper blanks a mis-detected non-English user transcript but still completes the turn', () => {
  const mapper = new RealtimeEventMapper({ language: 'en' });

  const delta = mapper.map({
    type: 'conversation.item.input_audio_transcription.delta',
    item_id: 'item-1',
    delta: '카이모어',
  });
  assert.deepEqual(delta, []);

  // The completed event must always reach the client (with the wrong-script
  // text stripped), otherwise the user's bubble stays stuck on "Transcribing...".
  const done = mapper.map({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'item-1',
    transcript: '教咪我',
  });
  assert.deepEqual(done, [{ type: 'user.text.done', itemId: 'item-1', text: '' }]);
});

test('RealtimeEventMapper completes the turn on an empty user transcript', () => {
  const mapper = new RealtimeEventMapper({ language: 'en' });
  const done = mapper.map({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'item-1',
    transcript: '  ',
  });
  assert.deepEqual(done, [{ type: 'user.text.done', itemId: 'item-1', text: '' }]);
});

test('RealtimeEventMapper flags an interrupted response as cancelled instead of done', () => {
  const mapper = new RealtimeEventMapper({ language: 'en' });

  mapper.map({
    type: 'response.output_text.delta',
    response_id: 'resp-1',
    item_id: 'item-1',
    content_index: 0,
    delta: 'These ulcers can bleed, especially if',
  });

  // Semantic VAD interrupted the response (the user spoke over it): the client
  // must learn the reply was cut off so it never reads the fragment aloud.
  const events = mapper.map({
    type: 'response.done',
    response: { id: 'resp-1', status: 'cancelled', output: [] },
  });

  assert.deepEqual(events, [{
    type: 'assistant.text.cancelled',
    text: 'These ulcers can bleed, especially if',
  }]);
});

test('RealtimeEventMapper emits cancelled even when no text streamed yet', () => {
  const mapper = new RealtimeEventMapper({ language: 'en' });
  const events = mapper.map({
    type: 'response.done',
    response: { id: 'resp-1', status: 'cancelled', output: [] },
  });

  assert.deepEqual(events, [{ type: 'assistant.text.cancelled', text: '' }]);
});

test('RealtimeEventMapper keeps an English user transcript in English mode', () => {
  const mapper = new RealtimeEventMapper({ language: 'en' });
  const events = mapper.map({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'item-1',
    transcript: 'teach me',
  });

  assert.equal(events[0].type, 'user.text.done');
  assert.equal(events[0].text, 'teach me');
});

test('RealtimeEventMapper keeps a Chinese user transcript in Chinese mode', () => {
  const mapper = new RealtimeEventMapper({ language: 'zh' });
  const events = mapper.map({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'item-1',
    transcript: '教咪我',
  });

  assert.equal(events[0].type, 'user.text.done');
  assert.equal(events[0].text, '教咪我');
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
