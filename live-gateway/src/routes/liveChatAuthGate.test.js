// Integration tests for the WebSocket authentication gate: a real HTTP server, a
// real ws client, a stubbed bridge. These exist because the security property
// that matters ("an unauthenticated socket never reaches OpenAI") lives in the
// wiring, not in any single function.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { WebSocket } from 'ws';

import { attachLiveChatSocket, LIVE_CHAT_PATH, turnFromAppEvent } from './liveChat.js';
import { createLiveChatAuthenticator } from '../services/liveChatAuth.js';

const IDENTITY = {
  oid: 'e3f1c0aa-1111-2222-3333-444455556666',
  email: 'cs-nathanael.ng@assoc.main.ntu.edu.sg',
  name: 'Nathanael Ng',
  tenantId: '45e82b6b-5ac4-41a7-a36f-e702e5e3a355',
};

class StubBridge extends EventEmitter {
  constructor() {
    super();
    this.connectCount = 0;
    this.audio = [];
    this.texts = [];
    this.systemPrompt = '';
  }

  connect() {
    this.connectCount += 1;
  }

  close() {}

  sendAudio(chunk) {
    this.audio.push(chunk);
  }

  sendText(text) {
    this.texts.push(text);
  }
}

async function startGateway({
  authenticator = null,
  authTimeoutMs = 150,
  transcriptStore = null,
  authExempt = () => false,
} = {}) {
  const bridges = [];
  const server = createServer();
  const socket = attachLiveChatSocket(server, {
    authenticator,
    transcriptStore,
    authTimeoutMs,
    authExempt,
    createBridge: () => {
      const bridge = new StubBridge();
      bridges.push(bridge);
      return bridge;
    },
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    bridges,
    url: `ws://127.0.0.1:${port}${LIVE_CHAT_PATH}`,
    async stop() {
      socket.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function connect(url, { origin = '' } = {}) {
  const client = new WebSocket(url, origin ? { headers: { Origin: origin } } : undefined);
  const messages = [];
  const closes = [];

  client.on('message', (data) => messages.push(JSON.parse(data.toString())));
  client.on('close', (code) => closes.push(code));

  return {
    client,
    messages,
    closes,
    opened: new Promise((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    }),
    closed: new Promise((resolve) => client.once('close', resolve)),
    send(payload) {
      client.send(JSON.stringify(payload));
    },
  };
}

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

function authenticatorAccepting(token, { loadTestSecret = '' } = {}) {
  return createLiveChatAuthenticator({
    verifier: {
      verify: async (candidate) => {
        if (candidate !== token) {
          const error = new Error('Token signature does not verify.');
          error.code = 'bad_signature';
          throw error;
        }
        return IDENTITY;
      },
    },
    loadTestSecret,
  });
}

test('with auth enabled, a valid token opens the session', async (t) => {
  const gateway = await startGateway({ authenticator: authenticatorAccepting('good') });
  t.after(() => gateway.stop());

  const session = connect(gateway.url);
  await session.opened;
  session.send({ type: 'session.auth', token: 'good' });
  await settle(250);

  assert.deepEqual(session.messages[0], { type: 'session.authenticated', synthetic: false });
  assert.equal(gateway.bridges[0].connectCount, 1);
});

test('an invalid token closes the socket and never reaches the bridge', async (t) => {
  const gateway = await startGateway({ authenticator: authenticatorAccepting('good') });
  t.after(() => gateway.stop());

  const session = connect(gateway.url);
  await session.opened;
  session.send({ type: 'session.auth', token: 'forged' });
  const code = await session.closed;

  assert.equal(code, 4401);
  assert.equal(session.messages[0].type, 'session.auth.failed');
  assert.equal(gateway.bridges[0].connectCount, 0, 'a forged token must not open a bridge');
});

test('skipping the auth frame closes the socket without connecting upstream', async (t) => {
  // The pre-auth client sends session.init first. Under auth that is a failure,
  // not a fallback — otherwise the gate would be trivially bypassed.
  const gateway = await startGateway({ authenticator: authenticatorAccepting('good') });
  t.after(() => gateway.stop());

  const session = connect(gateway.url);
  await session.opened;
  session.send({ type: 'session.init', systemPrompt: 'pretend I am allowed' });
  const code = await session.closed;

  assert.equal(code, 4401);
  assert.equal(gateway.bridges[0].connectCount, 0);
});

test('audio sent before authenticating is never forwarded', async (t) => {
  const gateway = await startGateway({ authenticator: authenticatorAccepting('good') });
  t.after(() => gateway.stop());

  const session = connect(gateway.url);
  await session.opened;
  session.send({ type: 'audio.chunk', audio: 'AAAA' });
  await session.closed;

  assert.equal(gateway.bridges[0].audio.length, 0);
  assert.equal(gateway.bridges[0].connectCount, 0);
});

test('a silent socket is closed when the auth window lapses', async (t) => {
  const gateway = await startGateway({
    authenticator: authenticatorAccepting('good'),
    authTimeoutMs: 100,
  });
  t.after(() => gateway.stop());

  const session = connect(gateway.url);
  await session.opened;
  const code = await session.closed;

  assert.equal(code, 4408);
  assert.equal(gateway.bridges[0].connectCount, 0);
});

test('messages sent immediately after the auth frame are not lost', async (t) => {
  // Real clients pipeline session.auth and session.init without waiting, so the
  // gate has to queue rather than drop while verification is in flight.
  const gateway = await startGateway({ authenticator: authenticatorAccepting('good') });
  t.after(() => gateway.stop());

  const session = connect(gateway.url);
  await session.opened;
  session.send({ type: 'session.auth', token: 'good' });
  session.send({ type: 'session.init', systemPrompt: 'Custom lesson prompt' });
  session.send({ type: 'user.text', text: 'What is melena?' });
  await settle(250);

  const bridge = gateway.bridges[0];
  assert.equal(bridge.systemPrompt, 'Custom lesson prompt');
  assert.deepEqual(bridge.texts, ['What is melena?']);
});

test('the load-test secret opens a session flagged as synthetic', async (t) => {
  const gateway = await startGateway({
    authenticator: authenticatorAccepting('good', { loadTestSecret: 'rehearsal' }),
  });
  t.after(() => gateway.stop());

  const session = connect(gateway.url);
  await session.opened;
  session.send({ type: 'session.auth', loadTestSecret: 'rehearsal', loadTestUser: 4 });
  await settle(250);

  assert.deepEqual(session.messages[0], { type: 'session.authenticated', synthetic: true });
  assert.equal(gateway.bridges[0].connectCount, 1);
});

test('a gateway with auth off ignores an auth frame instead of connecting early', async (t) => {
  // Rollout ordering: a client that already sends session.auth must still work
  // against a gateway where LIVE_AUTH_ENABLED is not yet on, without losing the
  // session.init that follows.
  const gateway = await startGateway({ authenticator: null });
  t.after(() => gateway.stop());

  const session = connect(gateway.url);
  await session.opened;
  session.send({ type: 'session.auth', token: 'ignored-here' });
  session.send({ type: 'session.init', systemPrompt: 'Prompt must survive' });
  await settle(250);

  assert.equal(gateway.bridges[0].systemPrompt, 'Prompt must survive');
  assert.equal(gateway.bridges[0].connectCount, 1);
});

test('with no authenticator configured the socket behaves exactly as before', async (t) => {
  // Guards the default deployment: until LIVE_AUTH_ENABLED is set, nothing about
  // the existing handshake changes.
  const gateway = await startGateway({ authenticator: null });
  t.after(() => gateway.stop());

  const session = connect(gateway.url);
  await session.opened;
  session.send({ type: 'session.init', systemPrompt: 'Legacy prompt' });
  await settle(250);

  assert.equal(gateway.bridges[0].connectCount, 1);
  assert.equal(gateway.bridges[0].systemPrompt, 'Legacy prompt');
  assert.equal(session.messages.length, 0, 'no auth handshake is sent to legacy clients');
});


function recordingStore() {
  const sessions = [];
  return {
    sessions,
    openSession(identity) {
      const turns = [];
      sessions.push({ identity, turns });
      return {
        recordTurn(turn) {
          turns.push(turn);
          return true;
        },
      };
    },
  };
}

test('turnFromAppEvent stores only completed turns', () => {
  assert.deepEqual(turnFromAppEvent({ type: 'user.text.done', text: 'Q' }), {
    role: 'user',
    text: 'Q',
  });
  assert.deepEqual(turnFromAppEvent({ type: 'assistant.text.done', text: 'A' }), {
    role: 'assistant',
    text: 'A',
  });
  assert.deepEqual(turnFromAppEvent({ type: 'assistant.text.cancelled', text: 'Par' }), {
    role: 'assistant',
    text: 'Par',
    cancelled: true,
  });

  // Deltas would otherwise write one row per token.
  assert.equal(turnFromAppEvent({ type: 'assistant.text.delta', text: 'A' }), null);
  assert.equal(turnFromAppEvent({ type: 'user.text.delta', text: 'Q' }), null);
  assert.equal(turnFromAppEvent({ type: 'assistant.thinking' }), null);
  assert.equal(turnFromAppEvent({ type: 'user.text.failed', message: 'bad' }), null);
  assert.equal(turnFromAppEvent(undefined), null);
});

test('an authenticated session records both sides of the conversation', async (t) => {
  const store = recordingStore();
  const gateway = await startGateway({
    authenticator: authenticatorAccepting('good'),
    transcriptStore: store,
  });
  t.after(() => gateway.stop());

  const session = connect(gateway.url);
  await session.opened;
  session.send({ type: 'session.auth', token: 'good' });
  await settle(250);

  gateway.bridges[0].emit('app-event', { type: 'user.text.done', text: 'What is melena?' });
  gateway.bridges[0].emit('app-event', { type: 'assistant.text.delta', text: 'Mel' });
  gateway.bridges[0].emit('app-event', { type: 'assistant.text.done', text: 'Dark stool.' });
  await settle(50);

  assert.equal(store.sessions.length, 1);
  assert.equal(store.sessions[0].identity.oid, IDENTITY.oid);
  assert.deepEqual(store.sessions[0].turns, [
    { role: 'user', text: 'What is melena?' },
    { role: 'assistant', text: 'Dark stool.' },
  ]);
});

test('a rejected connection opens no transcript session', async (t) => {
  // Nothing may be attributed to a caller who never proved who they are.
  const store = recordingStore();
  const gateway = await startGateway({
    authenticator: authenticatorAccepting('good'),
    transcriptStore: store,
  });
  t.after(() => gateway.stop());

  const session = connect(gateway.url);
  await session.opened;
  session.send({ type: 'session.auth', token: 'forged' });
  await session.closed;

  assert.deepEqual(store.sessions, []);
});

test('a store that throws on open leaves the conversation working', async (t) => {
  const gateway = await startGateway({
    authenticator: authenticatorAccepting('good'),
    transcriptStore: {
      openSession() {
        throw new Error('table missing');
      },
    },
  });
  t.after(() => gateway.stop());

  const session = connect(gateway.url);
  await session.opened;
  session.send({ type: 'session.auth', token: 'good' });
  await settle(250);

  assert.deepEqual(session.messages[0], { type: 'session.authenticated', synthetic: false });
  assert.equal(gateway.bridges[0].connectCount, 1, 'storage trouble must not block the chat');
});


// The open kiosk distribution has no sign-in at all. Without an exemption its
// socket is closed 4401 before OpenAI is ever dialled, which is what left the
// text-chat app stuck on "Preparing live chat..." forever.
test('an exempt origin opens a session without session.auth', async () => {
  const gateway = await startGateway({
    authenticator: authenticatorAccepting('good-token'),
    authExempt: (origin) => origin === 'https://kiosk.example',
  });

  try {
    const conn = connect(gateway.url, { origin: 'https://kiosk.example' });
    await conn.opened;
    conn.send({ type: 'session.init', systemPrompt: 'be brief' });
    await settle(120);

    assert.equal(conn.closes.length, 0, 'exempt socket must stay open');
    assert.equal(gateway.bridges.length, 1);
    assert.equal(gateway.bridges[0].connectCount, 1, 'bridge must dial upstream');
    assert.equal(gateway.bridges[0].systemPrompt, 'be brief');
    conn.client.close();
  } finally {
    await gateway.stop();
  }
});

test('a non-exempt origin still has to authenticate', async () => {
  const gateway = await startGateway({
    authenticator: authenticatorAccepting('good-token'),
    authExempt: (origin) => origin === 'https://kiosk.example',
  });

  try {
    const conn = connect(gateway.url, { origin: 'https://locked.example' });
    await conn.opened;
    conn.send({ type: 'session.init', systemPrompt: 'be brief' });
    await conn.closed;

    assert.equal(conn.closes[0], 4401);
    assert.equal(gateway.bridges[0]?.connectCount ?? 0, 0, 'must not reach OpenAI');
  } finally {
    await gateway.stop();
  }
});
