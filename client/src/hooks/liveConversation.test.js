import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLiveReplyParams,
  createChatMessage,
  findFirstReplayablePart,
  findSelectedPlayback,
  findNextPhrasePlayback,
  getMicOffAction,
  createLiveSynthesisSnapshot,
  splitLiveReplyPhrases,
  splitLiveReplyChunks,
  shortenFirstFastPhrase,
  shouldTriggerLiveBargeIn,
  shouldSendLiveMicAudio,
  updateMessage,
} from './liveConversation.js';

test('createLiveSynthesisSnapshot freezes Live Full engine and config for a queued reply', () => {
  const fastRefParams = { ref_audio_path: 'fast-ref.wav' };
  const fullRefParams = { ref_audio_path: 'full-ref.wav', top_k: 5 };
  const snapshot = createLiveSynthesisSnapshot({
    engine: 'full',
    refParams: fastRefParams,
    fullRefParams,
    voiceProfileId: 'alexv1',
  });

  assert.deepEqual(snapshot, {
    engine: 'full',
    refParams: {
      ...fullRefParams,
      voiceProfileId: 'alexv1',
    },
  });
});

test('buildLiveReplyParams preserves full inference voice identity', () => {
  const params = buildLiveReplyParams('Hello.', {
    ref_audio_path: 'refs/sample.wav',
    voiceProfileId: 'alexv1',
  });

  assert.equal(params.voiceProfileId, 'alexv1');
});

test('shortenFirstFastPhrase splits a long first phrase at its first clause boundary', () => {
  const phrases = [
    'After the model finishes loading the weights, it starts generating audio right away.',
    'Second phrase here.',
  ];
  const result = shortenFirstFastPhrase(phrases);
  assert.equal(result.length, 3);
  assert.equal(result[0], 'After the model finishes loading the weights.');
  assert.equal(result[1], 'it starts generating audio right away.');
  assert.equal(result[2], 'Second phrase here.');
});

test('shortenFirstFastPhrase leaves a short first phrase untouched', () => {
  const phrases = ['Hello there, friend.', 'Next.'];
  assert.deepEqual(shortenFirstFastPhrase(phrases), phrases);
});

test('shortenFirstFastPhrase does not split when a half would be too short', () => {
  // First clause boundary leaves a tiny head, so the phrase stays intact rather
  // than producing a clipped-sounding fragment.
  const phrases = ['Yes, the inference server is fully warmed up and ready to synthesize now.'];
  assert.deepEqual(shortenFirstFastPhrase(phrases), phrases);
});

test('buildLiveReplyParams forces English assistant text for full inference', () => {
  const params = buildLiveReplyParams(' Hello there. ', {
    ref_audio_path: 'refs/sample.wav',
    prompt_text: 'reference words',
    prompt_lang: 'ja',
    aux_ref_audio_paths: ['refs/aux-a.wav', 'refs/aux-b.wav'],
  });

  assert.deepEqual(params, {
    text: 'Hello there.',
    text_lang: 'en',
    ref_audio_path: 'refs/sample.wav',
    prompt_text: 'reference words',
    prompt_lang: 'ja',
    aux_ref_audio_paths: ['refs/aux-a.wav', 'refs/aux-b.wav'],
  });
});

test('buildLiveReplyParams maps selected Chinese to GPT-SoVITS all-Chinese text mode', () => {
  const params = buildLiveReplyParams('Ni hao.', {
    ref_audio_path: 'refs/sample.wav',
  }, 'zh');

  assert.equal(params.text_lang, 'all_zh');
});

test('buildLiveReplyParams carries Live Fast inference controls without changing split logic', () => {
  const params = buildLiveReplyParams('Hello.', {
    ref_audio_path: 'refs/sample.wav',
    prompt_text: 'reference words',
    prompt_lang: 'en',
    aux_ref_audio_paths: ['refs/aux-a.wav'],
    top_k: 12,
    top_p: 0.75,
    temperature: 0.65,
    repetition_penalty: 1.2,
    speed_factor: 0.9,
  });

  assert.equal(params.top_k, 12);
  assert.equal(params.top_p, 0.75);
  assert.equal(params.temperature, 0.65);
  assert.equal(params.repetition_penalty, 1.2);
  assert.equal(params.speed_factor, 0.9);
  assert.deepEqual(splitLiveReplyPhrases('One. Two.'), ['One.', 'Two.']);
});

test('buildLiveReplyParams removes Latin words from selected Chinese TTS text', () => {
  const params = buildLiveReplyParams(
    '气温在thirty度左右，湿度在seventy%到eighty%，Singapore feels hot。',
    { ref_audio_path: 'refs/sample.wav' },
    'zh'
  );

  assert.equal(params.text, '气温在30度左右，湿度在70%到80%。');
  assert.doesNotMatch(params.text, /\p{Script=Latin}/u);
  assert.equal(params.text_lang, 'all_zh');
});

test('buildLiveReplyParams removes non-ASCII Latin letters from selected Chinese TTS text', () => {
  const params = buildLiveReplyParams(
    '今天AI café Ｓｉｎｇａｐｏｒｅ天气不错。',
    { ref_audio_path: 'refs/sample.wav' },
    'zh'
  );

  assert.equal(params.text, '今天天气不错。');
  assert.doesNotMatch(params.text, /\p{Script=Latin}/u);
});

test('chat messages keep stable ids and can be patched immutably', () => {
  const message = createChatMessage({
    id: 'msg-1',
    role: 'assistant',
    text: 'Draft',
    status: 'thinking',
    createdAt: 123,
  });

  assert.equal(message.id, 'msg-1');
  assert.equal(message.role, 'assistant');
  assert.equal(message.text, 'Draft');
  assert.equal(message.status, 'thinking');

  const next = updateMessage([message], 'msg-1', { text: 'Done', status: 'ready' });

  assert.notEqual(next[0], message);
  assert.equal(next[0].text, 'Done');
  assert.equal(next[0].status, 'ready');
});

test('splitLiveReplyChunks defaults to one sentence and lets a short sentence absorb one neighbour', () => {
  assert.deepEqual(
    splitLiveReplyChunks('Yes. That helps. Thanks a lot.'),
    ['Yes. That helps.', 'Thanks a lot.'],
  );
});

test('splitLiveReplyChunks keeps normal sentences separate by default', () => {
  const first = 'This complete sentence contains enough useful words for stable synthesis.';
  const second = 'Another complete sentence also contains enough useful words for stable synthesis.';
  assert.deepEqual(splitLiveReplyChunks(`${first} ${second}`), [first, second]);
});

test('splitLiveReplyChunks gives an explicit sentence limit priority over the default', () => {
  const first = 'This complete sentence contains enough useful words for stable synthesis.';
  const second = 'Another complete sentence also contains enough useful words for stable synthesis.';
  assert.deepEqual(
    splitLiveReplyChunks(`${first} ${second}`, { maxSentencesPerChunk: 2 }),
    [`${first} ${second}`],
  );
});

test('splitLiveReplyChunks gives an explicit word limit priority over the 280-character default', () => {
  const sentence = `${Array.from({ length: 12 }, (_, index) => `extraordinarilylongword${index}`).join(' ')}.`;
  assert.ok(sentence.length > 280);
  assert.deepEqual(
    splitLiveReplyChunks(sentence, { maxChunkWords: 20 }),
    [sentence],
  );
});

test('splitLiveReplyChunks enforces an explicit word limit inside a long sentence', () => {
  const sentence = `${Array.from({ length: 23 }, (_, index) => `word${index}`).join(' ')}.`;
  const chunks = splitLiveReplyChunks(sentence, { maxChunkWords: 10 });
  assert.ok(chunks.length >= 3, JSON.stringify(chunks));
  assert.ok(chunks.every((chunk) => (chunk.match(/[\p{L}\p{N}']+/gu) || []).length <= 10));
  assert.equal(chunks.join(' '), sentence);
});

test('splitLiveReplyChunks breaks a long passage at sentence boundaries into multiple chunks', () => {
  const long = 'The mitochondrion is the powerhouse of the cell and supplies most of the chemical energy needed to drive many biochemical reactions throughout the body. '
    + 'Ribosomes are the molecular machines that read messenger RNA and assemble the corresponding chain of amino acids into a functioning protein for the organism.';
  const chunks = splitLiveReplyChunks(long);
  assert.ok(chunks.length >= 2, `expected multiple chunks, got ${chunks.length}`);
  // Every boundary lands on a sentence end (no mid-clause splits).
  for (const chunk of chunks.slice(0, -1)) {
    assert.match(chunk.trimEnd().slice(-1), /[.!?]/u);
  }
  // No words are lost across the split.
  assert.equal(chunks.join(' ').replace(/\s+/gu, ' ').trim(), long.replace(/\s+/gu, ' ').trim());
});

test('splitLiveReplyChunks keeps dotted initialisms intact and returns [] for empty text', () => {
  assert.deepEqual(splitLiveReplyChunks(''), []);
  assert.deepEqual(
    splitLiveReplyChunks('Order an E.C.G. now please.'),
    ['Order an E.C.G. now please.'],
  );
});

test('splitLiveReplyPhrases splits punctuation for immediate voice playback', () => {
  assert.deepEqual(splitLiveReplyPhrases('Hello there! How are you? I am ready'), [
    'Hello there!',
    'How are you?',
    'I am ready.',
  ]);
});

test('splitLiveReplyPhrases does not split dotted initialisms into tiny clips', () => {
  assert.deepEqual(splitLiveReplyPhrases('The W.H.O guidance changed. Next sentence.'), [
    'The W.H.O guidance changed.',
    'Next sentence.',
  ]);
  assert.deepEqual(splitLiveReplyPhrases('Order an E.C.G. now'), [
    'Order an E.C.G. now.',
  ]);
});

test('splitLiveReplyPhrases breaks at em dashes so the voice pauses', () => {
  assert.deepEqual(
    splitLiveReplyPhrases('a mix of cultures — Chinese, Malay, and more.'),
    ['a mix of cultures.', 'Chinese, Malay, and more.'],
  );
});

test('splitLiveReplyPhrases splits Chinese punctuation for fast playback', () => {
  assert.deepEqual(splitLiveReplyPhrases('你好！我可以帮你。'), [
    '你好！',
    '我可以帮你。',
  ]);
});

test('findSelectedPlayback never falls back to previous audio', () => {
  const previous = createChatMessage({
    id: 'old',
    role: 'assistant',
    text: 'Old reply',
    audioUrl: 'blob:old',
  });
  const next = createChatMessage({
    id: 'new',
    role: 'assistant',
    text: 'New reply',
    status: 'generating_voice',
  });

  assert.equal(findSelectedPlayback([previous, next], 'new'), null);
  assert.equal(findSelectedPlayback([previous, next], 'old').audioUrl, 'blob:old');
});

test('findNextPhrasePlayback advances through every ready phrase clip in order', () => {
  const message = createChatMessage({
    id: 'reply-1',
    role: 'assistant',
    text: 'First. Second. Third.',
    audioParts: [
      { id: 'reply-1-part-1', index: 1, status: 'played', audioUrl: 'blob:first' },
      { id: 'reply-1-part-2', index: 2, status: 'ready', audioUrl: 'blob:second' },
      { id: 'reply-1-part-3', index: 3, status: 'ready', audioUrl: 'blob:third' },
    ],
  });

  const second = findNextPhrasePlayback([message], 'reply-1-part-1');
  assert.equal(second.part.id, 'reply-1-part-2');

  const third = findNextPhrasePlayback([message], 'reply-1-part-2');
  assert.equal(third.part.id, 'reply-1-part-3');

  assert.equal(findNextPhrasePlayback([message], 'reply-1-part-3'), null);
});

test('findNextPhrasePlayback can replay phrase clips that were already played', () => {
  const message = createChatMessage({
    id: 'reply-replay',
    role: 'assistant',
    audioParts: [
      { id: 'reply-replay-part-1', index: 1, status: 'played', audioUrl: 'blob:first' },
      { id: 'reply-replay-part-2', index: 2, status: 'played', audioUrl: 'blob:second' },
    ],
  });

  const second = findNextPhrasePlayback([message], 'reply-replay-part-1');
  assert.equal(second.part.id, 'reply-replay-part-2');
});

test('shouldSendLiveMicAudio only allows enabled mic input during listening phases', () => {
  assert.equal(shouldSendLiveMicAudio({ phase: 'listening', micInputEnabled: true }), true);
  assert.equal(shouldSendLiveMicAudio({ phase: 'thinking', micInputEnabled: true }), true);
  assert.equal(shouldSendLiveMicAudio({ phase: 'speaking', micInputEnabled: true }), false);
  assert.equal(shouldSendLiveMicAudio({ phase: 'listening', micInputEnabled: false }), false);
});

test('getMicOffAction commits active speech without pausing an in-flight response', () => {
  assert.equal(getMicOffAction({ phase: 'listening', hasPendingAudio: true }), 'commit');
  assert.equal(getMicOffAction({ phase: 'listening', hasPendingAudio: false }), 'pause');
  assert.equal(getMicOffAction({ phase: 'thinking', hasPendingAudio: true }), 'wait');
  assert.equal(getMicOffAction({ phase: 'speaking', hasPendingAudio: true }), 'pause');
});

test('findFirstReplayablePart allows replaying clips that were already played', () => {
  const message = createChatMessage({
    id: 'reply-2',
    role: 'assistant',
    audioParts: [
      { id: 'reply-2-part-1', index: 1, status: 'played', audioUrl: 'blob:first' },
      { id: 'reply-2-part-2', index: 2, status: 'ready', audioUrl: 'blob:second' },
    ],
  });

  assert.equal(findFirstReplayablePart(message).id, 'reply-2-part-1');
});

test('shouldTriggerLiveBargeIn only reacts to deliberate speech during cloned playback', () => {
  assert.equal(shouldTriggerLiveBargeIn({
    phase: 'speaking',
    micInputEnabled: true,
    rms: 0.06,
  }), true);
  assert.equal(shouldTriggerLiveBargeIn({
    phase: 'speaking',
    micInputEnabled: true,
    rms: 0.01,
  }), false);
  assert.equal(shouldTriggerLiveBargeIn({
    phase: 'listening',
    micInputEnabled: true,
    rms: 0.06,
  }), false);
  assert.equal(shouldTriggerLiveBargeIn({
    phase: 'speaking',
    micInputEnabled: false,
    rms: 0.06,
  }), false);
});
