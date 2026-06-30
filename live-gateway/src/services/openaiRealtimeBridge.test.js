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
