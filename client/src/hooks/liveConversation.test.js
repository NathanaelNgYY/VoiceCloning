import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveReplyParams, createChatMessage, updateMessage } from './liveConversation.js';

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
