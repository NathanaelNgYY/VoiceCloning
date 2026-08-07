import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RealtimeEventMapper,
  buildRealtimeSessionUpdate,
  buildVideoPositionItem,
} from './openaiRealtimeEvents.js';

test('buildVideoPositionItem treats behavior as uncertain learning signals', () => {
  const item = buildVideoPositionItem(120, {
    paused: true,
    behavior: {
      largestBackwardSeekSeconds: 120,
      pauseDurationSeconds: 20,
      transcriptReading: true,
    },
  });
  const note = item.item.content[0].text;
  assert.match(note, /may indicate review or uncertainty/);
  assert.match(note, /may indicate reading or reflection/);
  assert.match(note, /never state that the student is confused, clear, or being monitored/);
});

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

test('buildRealtimeSessionUpdate asks for a short opener and spoken-style phrasing', () => {
  const update = buildRealtimeSessionUpdate({ language: 'en' });
  // Short first sentence → the first TTS clip is small → voice starts sooner.
  assert.match(update.session.instructions, /Open every reply with a short sentence/);
  // Spoken-style delivery: contractions, varied sentence length, no list formatting.
  assert.match(update.session.instructions, /contractions/);
  assert.match(update.session.instructions, /Never write lists/);
});

test('buildRealtimeSessionUpdate appends prosody guidance for the Chinese prompt too', () => {
  const update = buildRealtimeSessionUpdate({ language: 'zh' });
  assert.match(
    update.session.instructions,
    /End every sentence with a period, question mark, or exclamation mark\./,
  );
});

test('buildRealtimeSessionUpdate keeps the markdown structure of a scoped prompt', () => {
  // The GI lesson prompt is markdown: headings are what separate the scope gate
  // from the teaching material it governs. Flattening it to one line left the
  // gate as a clause in a wall of text and off-topic small talk stopped being
  // refused, so line structure has to survive verbatim.
  const scoped = [
    '# Non-Negotiable Scope Gate',
    '',
    'Apply this gate before answering every user message.',
    '',
    '',
    '',
    'Out-of-scope examples include weather, sports, and personal conversation.   ',
    '',
    '# Final Scope Check',
    '',
    'Verify every sentence before sending.',
  ].join('\n');

  const { session: { instructions } } = buildRealtimeSessionUpdate({ language: 'en', systemPrompt: scoped });

  assert.match(instructions, /^# Non-Negotiable Scope Gate$/m);
  assert.match(instructions, /^# Final Scope Check$/m);
  assert.match(instructions, /# Non-Negotiable Scope Gate\n\nApply this gate/);
  // Blank runs are capped and trailing spaces stripped, but nothing is joined.
  assert.doesNotMatch(instructions, /\n{3,}/);
  assert.doesNotMatch(instructions, / \n/);
});

test('buildRealtimeSessionUpdate gives the prompt body the last word, not prosody', () => {
  // Whatever sits closest to the end of the instructions is weighed most each
  // turn. A scoped prompt ends with its scope check; prosody must not displace it.
  const scoped = '# Scope Gate\n\nRefuse anything off topic.\n\n# Final Scope Check\n\nVerify before sending.';
  const { session: { instructions } } = buildRealtimeSessionUpdate({ language: 'en', systemPrompt: scoped });

  assert.ok(
    instructions.indexOf('Never write lists') < instructions.indexOf('# Final Scope Check'),
    'prosody guidance must come before the prompt body',
  );
  assert.ok(
    instructions.indexOf('Always respond only in English') < instructions.indexOf('# Scope Gate'),
    'language instruction must come before the prompt body',
  );
  assert.match(instructions, /Verify before sending\.$/);
});

test('RealtimeEventMapper forwards the item id on speech start/stop so the client can key turn bubbles', () => {
  const mapper = new RealtimeEventMapper({ language: 'en' });

  assert.deepEqual(
    mapper.map({ type: 'input_audio_buffer.speech_started', item_id: 'item_A' }),
    [{ type: 'user.speech.started', itemId: 'item_A' }],
  );
  assert.deepEqual(
    mapper.map({ type: 'input_audio_buffer.speech_stopped', item_id: 'item_A' }),
    [{ type: 'user.speech.stopped', itemId: 'item_A' }],
  );
  // Missing item_id degrades to an empty key, never undefined.
  assert.deepEqual(
    mapper.map({ type: 'input_audio_buffer.speech_started' }),
    [{ type: 'user.speech.started', itemId: '' }],
  );
});

test('buildRealtimeSessionUpdate transcribes user speech with the full-size model', () => {
  const update = buildRealtimeSessionUpdate({ language: 'en' });
  // Display transcripts come from a side-channel model, not gpt-realtime itself.
  // The mini transcriber kept mangling short utterances ("GIB" -> "GPT") and
  // mis-detecting English as CJK; the full-size model is markedly more accurate.
  assert.equal(update.session.audio.input.transcription.model, 'gpt-4o-transcribe');
});
