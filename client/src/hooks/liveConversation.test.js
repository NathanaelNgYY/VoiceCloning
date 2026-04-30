import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLiveReplyParams,
  createChatMessage,
  findSelectedPlayback,
  findNextPhrasePlayback,
  splitLiveReplyPhrases,
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

test('shouldSendLiveMicAudio only allows enabled mic input during listening phases', () => {
  assert.equal(shouldSendLiveMicAudio({ phase: 'listening', micInputEnabled: true }), true);
  assert.equal(shouldSendLiveMicAudio({ phase: 'thinking', micInputEnabled: true }), true);
  assert.equal(shouldSendLiveMicAudio({ phase: 'speaking', micInputEnabled: true }), false);
  assert.equal(shouldSendLiveMicAudio({ phase: 'listening', micInputEnabled: false }), false);
});
