import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLiveReplyParams,
  createChatMessage,
  findSelectedPlayback,
  splitLiveReplyPhrases,
  updateMessage,
} from './liveConversation.js';

test('buildLiveReplyParams forces English assistant text for full inference', () => {
  const params = buildLiveReplyParams(' Hello there. ', {
    ref_audio_path: 'refs/sample.wav',
    prompt_text: 'reference words',
    prompt_lang: 'ja',
  });

  assert.deepEqual(params, {
    text: 'Hello there.',
    text_lang: 'en',
    ref_audio_path: 'refs/sample.wav',
    prompt_text: 'reference words',
    prompt_lang: 'ja',
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
