import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiRealtimeBridge } from './openaiRealtimeBridge.js';

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
