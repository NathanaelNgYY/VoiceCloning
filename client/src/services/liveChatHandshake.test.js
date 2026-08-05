import assert from 'node:assert/strict';
import test from 'node:test';

import { createHandshakeSequencer, MAX_QUEUED_FRAMES } from './liveChatHandshake.js';

function recorder() {
  const sent = [];
  return { sent, send: (payload) => sent.push(payload) };
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test('without a token getter the handshake is just session.init', async () => {
  const { sent, send } = recorder();
  const sequencer = createHandshakeSequencer({ send });

  await sequencer.run({ systemPrompt: 'Lesson prompt' });

  assert.deepEqual(sent, [{ type: 'session.init', systemPrompt: 'Lesson prompt' }]);
  assert.equal(sequencer.isComplete, true);
});

test('the auth frame is sent before session.init', async () => {
  const { sent, send } = recorder();
  const sequencer = createHandshakeSequencer({ send });

  await sequencer.run({ getAuthToken: async () => 'token-abc', systemPrompt: 'Lesson' });

  assert.deepEqual(sent, [
    { type: 'session.auth', token: 'token-abc' },
    { type: 'session.init', systemPrompt: 'Lesson' },
  ]);
});

test('frames offered during token acquisition are released in order behind the handshake', async () => {
  // The failure this prevents: an audio chunk arriving first, being read by the
  // gateway as the handshake, and closing the socket with 4401.
  const { sent, send } = recorder();
  const sequencer = createHandshakeSequencer({ send });
  const token = deferred();

  const running = sequencer.run({
    getAuthToken: () => token.promise,
    systemPrompt: 'Lesson',
  });

  assert.equal(sequencer.offer({ type: 'audio.chunk', audio: 'AAAA' }), true);
  assert.equal(sequencer.offer({ type: 'audio.chunk', audio: 'BBBB' }), true);
  assert.deepEqual(sent, [], 'nothing may be sent before the handshake');

  token.resolve('token-abc');
  await running;

  assert.deepEqual(sent, [
    { type: 'session.auth', token: 'token-abc' },
    { type: 'session.init', systemPrompt: 'Lesson' },
    { type: 'audio.chunk', audio: 'AAAA' },
    { type: 'audio.chunk', audio: 'BBBB' },
  ]);
});

test('frames offered after the handshake go straight out', async () => {
  const { sent, send } = recorder();
  const sequencer = createHandshakeSequencer({ send });

  await sequencer.run({ getAuthToken: async () => 'token-abc' });
  sequencer.offer({ type: 'user.text', text: 'What is melena?' });

  assert.deepEqual(sent.at(-1), { type: 'user.text', text: 'What is melena?' });
  assert.equal(sequencer.queuedCount, 0);
});

test('the queue is bounded and reports dropped frames', () => {
  const { sent, send } = recorder();
  const sequencer = createHandshakeSequencer({ send });

  for (let index = 0; index < MAX_QUEUED_FRAMES; index += 1) {
    assert.equal(sequencer.offer({ type: 'audio.chunk', audio: index }), true);
  }

  assert.equal(sequencer.offer({ type: 'audio.chunk', audio: 'overflow' }), false);
  assert.equal(sequencer.queuedCount, MAX_QUEUED_FRAMES);
  assert.deepEqual(sent, []);
});

test('a failed token acquisition rejects and leaves the handshake incomplete', async () => {
  // The caller closes the socket on this path; staying incomplete means no
  // half-authenticated frames are ever flushed.
  const { sent, send } = recorder();
  const sequencer = createHandshakeSequencer({ send });
  sequencer.offer({ type: 'audio.chunk', audio: 'AAAA' });

  await assert.rejects(
    () => sequencer.run({ getAuthToken: async () => { throw new Error('interaction required'); } }),
    /interaction required/,
  );

  assert.equal(sequencer.isComplete, false);
  assert.deepEqual(sent, [], 'no frame may be sent when sign-in failed');
});

test('an empty system prompt is still sent as a string', async () => {
  const { sent, send } = recorder();
  const sequencer = createHandshakeSequencer({ send });

  await sequencer.run({});

  assert.deepEqual(sent, [{ type: 'session.init', systemPrompt: '' }]);
});
