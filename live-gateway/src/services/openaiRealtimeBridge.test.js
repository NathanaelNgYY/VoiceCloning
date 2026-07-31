import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiRealtimeBridge } from './openaiRealtimeBridge.js';
import { buildRealtimeSessionUpdate } from './openaiRealtimeEvents.js';

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
}

function createBridgeWithOpenSocket() {
  const sent = [];
  const bridge = new OpenAiRealtimeBridge({
    apiKey: 'test-key',
    WebSocketClass: FakeWebSocket,
  });

  bridge.closed = false;
  bridge.socket = {
    readyState: FakeWebSocket.OPEN,
    send(payload) {
      sent.push(JSON.parse(payload));
    },
  };

  return { bridge, sent };
}

test('commitInput commits pending audio and requests one assistant response', () => {
  const { bridge, sent } = createBridgeWithOpenSocket();

  assert.equal(bridge.sendAudio('abc'), true);
  assert.equal(bridge.commitInput(), true);
  assert.equal(bridge.sendAudio('after-commit'), false);

  assert.deepEqual(sent.map((message) => message.type), [
    'input_audio_buffer.append',
    'input_audio_buffer.commit',
    'response.create',
  ]);
});

test('commitInput does nothing when there is no pending audio', () => {
  const { bridge, sent } = createBridgeWithOpenSocket();

  assert.equal(bridge.commitInput(), false);
  assert.deepEqual(sent, []);
});

test('session.update uses an overridden systemPrompt set before connect', () => {
  const sent = [];
  const bridge = new OpenAiRealtimeBridge({
    apiKey: 'test-key',
    WebSocketClass: FakeWebSocket,
  });

  // Simulate the gateway applying a per-connection prompt before connect().
  bridge.systemPrompt = 'You are a GI bleeding tutor.';
  bridge.closed = false;
  bridge.socket = {
    readyState: FakeWebSocket.OPEN,
    send(payload) { sent.push(JSON.parse(payload)); },
    on() {},
  };

  // Re-run the open handler's session.update directly.
  bridge.sendOpenAi(
    buildRealtimeSessionUpdate({
      systemPrompt: bridge.systemPrompt,
      vadMode: bridge.vadMode,
      language: bridge.language,
    }),
  );

  const update = sent.find((m) => m.type === 'session.update');
  assert.ok(update, 'expected a session.update message');
  assert.ok(
    update.session.instructions.includes('You are a GI bleeding tutor.'),
    'instructions should include the overridden prompt',
  );
});

test('setVideoPosition rejects readings that are not a usable time', () => {
  const { bridge } = createBridgeWithOpenSocket();

  assert.equal(bridge.setVideoPosition({ seconds: 'soon' }), false);
  assert.equal(bridge.setVideoPosition({ seconds: -3 }), false);
  assert.equal(bridge.setVideoPosition({}), false);
  assert.equal(bridge.videoPositionSeconds, null);

  assert.equal(bridge.setVideoPosition({ seconds: 512.4, paused: true }), true);
  assert.equal(bridge.videoPositionSeconds, 512.4);
  assert.equal(bridge.videoPaused, true);
});

test('injectVideoPosition sends nothing until a position is known', () => {
  const { bridge, sent } = createBridgeWithOpenSocket();

  assert.equal(bridge.injectVideoPosition(), false);
  assert.deepEqual(sent, []);
});

test('sendText adds a typed question as a user turn and asks for the reply', () => {
  const { bridge, sent } = createBridgeWithOpenSocket();

  assert.equal(bridge.sendText('  What causes an upper GI bleed?  '), true);

  assert.deepEqual(sent.map((message) => message.type), [
    'conversation.item.create',
    'response.create',
  ]);
  assert.deepEqual(sent[0].item, {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: 'What causes an upper GI bleed?' }],
  });
});

test('sendText ignores an empty message and a closed bridge', () => {
  const { bridge, sent } = createBridgeWithOpenSocket();

  assert.equal(bridge.sendText('   '), false);
  assert.equal(bridge.sendText(null), false);
  // A non-string frame field must not be coerced into the conversation.
  assert.equal(bridge.sendText({ text: 'nested' }), false);
  assert.equal(bridge.sendText(42), false);

  bridge.closed = true;
  assert.equal(bridge.sendText('hello'), false);
  assert.deepEqual(sent, []);
});

test('sendText drops audio captured while the user was typing', () => {
  const { bridge, sent } = createBridgeWithOpenSocket();

  bridge.sendAudio('half-an-utterance');
  bridge.sendText('Actually, let me type it.');

  assert.deepEqual(sent.map((message) => message.type), [
    'input_audio_buffer.append',
    'conversation.item.create',
    'input_audio_buffer.clear',
    'response.create',
  ]);
  // The stale audio must not be committable onto the next turn.
  assert.equal(bridge.commitInput(), false);
});

test('sendText carries the lesson video position into a typed turn', () => {
  const { bridge, sent } = createBridgeWithOpenSocket();
  bridge.setVideoPosition({ seconds: 512.4, paused: true });

  bridge.sendText('What does she mean here?');

  const items = sent.filter((message) => message.type === 'conversation.item.create');
  assert.equal(items.length, 2);
  assert.equal(items[0].item.role, 'system');
  assert.match(items[0].item.content[0].text, /paused at 8:32/);
  assert.equal(items[1].item.role, 'user');
});

test('speech_started injects the video position as a hidden system note', () => {
  const { bridge, sent } = createBridgeWithOpenSocket();
  bridge.setVideoPosition({ seconds: 512.4, paused: true });

  bridge.handleMessage(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));

  const item = sent.find((message) => message.type === 'conversation.item.create');
  assert.ok(item, 'expected a conversation item to be injected');
  assert.equal(item.item.role, 'system');
  assert.match(item.item.content[0].text, /paused at 8:32/);
});

test('the position note is not re-injected while the video has barely moved', () => {
  const { bridge, sent } = createBridgeWithOpenSocket();
  const speak = () => bridge.handleMessage(
    JSON.stringify({ type: 'input_audio_buffer.speech_started' }),
  );

  bridge.setVideoPosition({ seconds: 100, paused: true });
  speak();
  bridge.setVideoPosition({ seconds: 101, paused: true });
  speak();
  assert.equal(sent.filter((m) => m.type === 'conversation.item.create').length, 1);

  bridge.setVideoPosition({ seconds: 140, paused: false });
  speak();
  const notes = sent.filter((m) => m.type === 'conversation.item.create');
  assert.equal(notes.length, 2);
  assert.match(notes[1].item.content[0].text, /playing at 2:20/);
});

test('a video position never turns into a visible chat message', () => {
  const { bridge } = createBridgeWithOpenSocket();
  const appEvents = [];
  bridge.on('app-event', (event) => appEvents.push(event.type));

  bridge.setVideoPosition({ seconds: 512.4, paused: true });
  bridge.handleMessage(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
  bridge.handleMessage(JSON.stringify({ type: 'conversation.item.created', item: {} }));

  assert.deepEqual(appEvents, ['user.speech.started']);
});
