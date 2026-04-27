import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBrowserMessage, originAllowed } from './liveChat.js';

test('originAllowed accepts configured production origin and same-origin upgrades', () => {
  assert.equal(originAllowed('https://app.example.com', {
    nodeEnv: 'production',
    corsOrigin: 'https://app.example.com',
    requestHost: 'live.example.com',
  }), true);

  assert.equal(originAllowed('https://live.example.com', {
    nodeEnv: 'production',
    corsOrigin: 'https://app.example.com',
    requestHost: 'live.example.com',
  }), true);
});

test('originAllowed rejects untrusted production origins', () => {
  assert.equal(originAllowed('https://bad.example.com', {
    nodeEnv: 'production',
    corsOrigin: 'https://app.example.com',
    requestHost: 'live.example.com',
  }), false);
});

test('handleBrowserMessage forwards browser controls to bridge methods', () => {
  const calls = [];
  const bridge = {
    sendAudio(audio) { calls.push(['audio', audio]); },
    pauseInput() { calls.push(['pause']); },
    resumeInput() { calls.push(['resume']); },
    cancelResponse() { calls.push(['cancel']); },
  };

  handleBrowserMessage(bridge, Buffer.from(JSON.stringify({ type: 'audio.chunk', audio: 'abc' })));
  handleBrowserMessage(bridge, Buffer.from(JSON.stringify({ type: 'input.pause' })));
  handleBrowserMessage(bridge, Buffer.from(JSON.stringify({ type: 'input.resume' })));
  handleBrowserMessage(bridge, Buffer.from(JSON.stringify({ type: 'response.cancel' })));

  assert.deepEqual(calls, [
    ['audio', 'abc'],
    ['pause'],
    ['resume'],
    ['cancel'],
  ]);
});
