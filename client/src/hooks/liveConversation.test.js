import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLiveReplyParams,
  createChatMessage,
  findFirstReplayablePart,
  findSelectedPlayback,
  findNextPhrasePlayback,
  getMicOffAction,
  splitLiveReplyPhrases,
  shouldTriggerLiveBargeIn,
  shouldSendLiveMicAudio,
  updateMessage,
} from './liveConversation.js';

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

test('buildLiveReplyParams removes Latin words from selected Chinese TTS text', () => {
  const params = buildLiveReplyParams(
    '气温在thirty度左右，湿度在seventy%到eighty%。',
    { ref_audio_path: 'refs/sample.wav' },
    'zh'
  );

  assert.equal(params.text, '气温在30度左右，湿度在70%到80%。');
  assert.doesNotMatch(params.text, /[A-Za-z]/);
  assert.equal(params.text_lang, 'all_zh');
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

test('splitLiveReplyPhrases splits punctuation for immediate voice playback', () => {
  assert.deepEqual(splitLiveReplyPhrases('Hello there! How are you? I am ready'), [
    'Hello there!',
    'How are you?',
    'I am ready.',
  ]);
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
