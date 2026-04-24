import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { OpenAiRealtimeBridge } from './openaiRealtimeBridge.js';

class FakeWebSocket extends EventEmitter {
  static CONNECTING = 0;

  static OPEN = 1;

  static CLOSING = 2;

  static CLOSED = 3;

  static instances = [];

  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  send(message) {
    this.sent.push(message);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }
}

function resetFakeSockets() {
  FakeWebSocket.instances = [];
}

function collectAppEvents(bridge) {
  const events = [];
  bridge.on('app-event', (event) => events.push(event));
  return events;
}

test('missing API key emits error and close without throwing', () => {
  resetFakeSockets();
  const bridge = new OpenAiRealtimeBridge({
    apiKey: '',
    WebSocketClass: FakeWebSocket,
  });
  const appEvents = collectAppEvents(bridge);
  let closeEvents = 0;
  bridge.on('close', () => {
    closeEvents += 1;
  });

  assert.doesNotThrow(() => bridge.connect());

  assert.deepEqual(appEvents, [
    {
      type: 'error',
      message: 'OpenAI Realtime is not configured. Set OPENAI_API_KEY on the backend.',
      code: 'openai_realtime_missing_config',
    },
    { type: 'session.closed' },
  ]);
  assert.equal(closeEvents, 1);
  assert.equal(FakeWebSocket.instances.length, 0);
});

test('stale socket close does not emit session.closed for active newer socket', () => {
  resetFakeSockets();
  const bridge = new OpenAiRealtimeBridge({
    apiKey: 'sk-test',
    WebSocketClass: FakeWebSocket,
  });
  const appEvents = collectAppEvents(bridge);

  bridge.connect();
  const staleSocket = FakeWebSocket.instances[0];
  bridge.connect();
  const activeSocket = FakeWebSocket.instances[1];

  staleSocket.emit('close');

  assert.equal(bridge.socket, activeSocket);
  assert.equal(appEvents.some((event) => event.type === 'session.closed'), false);
});

test('sendAudio reports whether audio was sent', () => {
  resetFakeSockets();
  const bridge = new OpenAiRealtimeBridge({
    apiKey: 'sk-test',
    WebSocketClass: FakeWebSocket,
  });

  bridge.connect();
  const socket = FakeWebSocket.instances[0];

  assert.equal(bridge.sendAudio('audio-before-open'), false);

  socket.open();
  socket.sent = [];

  assert.equal(bridge.sendAudio('audio-after-open'), true);
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    type: 'input_audio_buffer.append',
    audio: 'audio-after-open',
  });

  bridge.pauseInput();
  socket.sent = [];

  assert.equal(bridge.sendAudio('audio-while-paused'), false);
  assert.equal(socket.sent.length, 0);
});
