import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import {
  LIVE_CHAT_PATH,
  attachLiveChatSocket,
  originAllowed,
} from './liveChat.js';

class FakeSocket {
  constructor() {
    this.writes = [];
    this.destroyed = false;
  }

  write(payload) {
    this.writes.push(payload);
  }

  destroy() {
    this.destroyed = true;
  }
}

function triggerUpgrade(req) {
  const server = new EventEmitter();
  const liveChat = attachLiveChatSocket(server);
  const socket = new FakeSocket();

  try {
    server.emit('upgrade', req, socket, Buffer.alloc(0));
  } finally {
    liveChat.close();
  }

  return socket;
}

test('originAllowed rejects configured origins by default in production', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    assert.equal(originAllowed('https://untrusted.example'), false);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

test('originAllowed keeps non-production upgrades permissive', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  try {
    assert.equal(originAllowed('https://untrusted.example'), true);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

test('unknown upgrade paths are rejected and destroyed', () => {
  const socket = triggerUpgrade({
    url: '/not-live-chat',
    headers: { host: 'localhost' },
  });

  assert.equal(socket.writes[0], 'HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  assert.equal(socket.destroyed, true);
});

test('malformed upgrade URLs are rejected as bad requests', () => {
  const socket = triggerUpgrade({
    url: LIVE_CHAT_PATH,
    headers: { host: 'bad host' },
  });

  assert.equal(socket.writes[0], 'HTTP/1.1 400 Bad Request\r\n\r\n');
  assert.equal(socket.destroyed, true);
});
