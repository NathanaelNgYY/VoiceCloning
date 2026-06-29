import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLiveChatInitToBridge,
  getLiveChatLanguage,
  handleBrowserMessage,
  originAllowed,
  parseLiveChatInit,
} from './liveChat.js';

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

test('originAllowed accepts either CloudFront from a comma-separated production list', () => {
  assert.equal(originAllowed('https://training.example.com', {
    nodeEnv: 'production',
    corsOrigin: 'https://training.example.com,https://live-fast.example.com',
    requestHost: 'live.example.com',
  }), true);

  assert.equal(originAllowed('https://live-fast.example.com', {
    nodeEnv: 'production',
    corsOrigin: 'https://training.example.com,https://live-fast.example.com',
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

test('originAllowed rejects production upgrades that omit the Origin header', () => {
  assert.equal(originAllowed('', {
    nodeEnv: 'production',
    corsOrigin: 'https://app.example.com',
    requestHost: 'live.example.com',
  }), false);
});

test('originAllowed still allows non-production upgrades without an Origin', () => {
  assert.equal(originAllowed('', {
    nodeEnv: 'development',
    corsOrigin: 'https://app.example.com',
    requestHost: 'live.example.com',
  }), true);
});

test('getLiveChatLanguage accepts supported language query values and defaults to English', () => {
  assert.equal(getLiveChatLanguage(new URL('http://localhost/api/live/chat/realtime?language=zh')), 'zh');
  assert.equal(getLiveChatLanguage(new URL('http://localhost/api/live/chat/realtime?language=ja')), 'en');
  assert.equal(getLiveChatLanguage(new URL('http://localhost/api/live/chat/realtime')), 'en');
});

test('handleBrowserMessage forwards browser controls to bridge methods', () => {
  const calls = [];
  const bridge = {
    sendAudio(audio) { calls.push(['audio', audio]); },
    pauseInput() { calls.push(['pause']); },
    resumeInput() { calls.push(['resume']); },
    commitInput() { calls.push(['commit']); },
    cancelResponse() { calls.push(['cancel']); },
  };

  handleBrowserMessage(bridge, Buffer.from(JSON.stringify({ type: 'audio.chunk', audio: 'abc' })));
  handleBrowserMessage(bridge, Buffer.from(JSON.stringify({ type: 'input.pause' })));
  handleBrowserMessage(bridge, Buffer.from(JSON.stringify({ type: 'input.resume' })));
  handleBrowserMessage(bridge, Buffer.from(JSON.stringify({ type: 'input.commit' })));
  handleBrowserMessage(bridge, Buffer.from(JSON.stringify({ type: 'response.cancel' })));

  assert.deepEqual(calls, [
    ['audio', 'abc'],
    ['pause'],
    ['resume'],
    ['commit'],
    ['cancel'],
  ]);
});

test('parseLiveChatInit returns the systemPrompt for a session.init message', () => {
  assert.deepEqual(
    parseLiveChatInit(Buffer.from(JSON.stringify({ type: 'session.init', systemPrompt: 'Be a GI tutor.' }))),
    { systemPrompt: 'Be a GI tutor.' },
  );
});

test('parseLiveChatInit coerces a missing systemPrompt to empty string', () => {
  assert.deepEqual(
    parseLiveChatInit(Buffer.from(JSON.stringify({ type: 'session.init' }))),
    { systemPrompt: '' },
  );
});

test('parseLiveChatInit returns null for non-init or malformed messages', () => {
  assert.equal(parseLiveChatInit(Buffer.from(JSON.stringify({ type: 'audio.chunk', audio: 'x' }))), null);
  assert.equal(parseLiveChatInit(Buffer.from('not json')), null);
});

test('applyLiveChatInitToBridge overrides systemPrompt only when non-empty', () => {
  const bridge = { systemPrompt: 'server default' };

  applyLiveChatInitToBridge(bridge, { systemPrompt: '   ' });
  assert.equal(bridge.systemPrompt, 'server default');

  applyLiveChatInitToBridge(bridge, { systemPrompt: 'Be a GI tutor.' });
  assert.equal(bridge.systemPrompt, 'Be a GI tutor.');
});
