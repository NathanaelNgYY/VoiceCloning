import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHATBOT_SYSTEM_PROMPT,
  CHATBOT_SYSTEM_PROMPT_PATH,
  getDefaultChatbotSystemPrompt,
  fetchSharedChatbotSystemPrompt,
  saveSharedChatbotSystemPrompt,
} from './chatbotSystemPrompt.js';

const ENDPOINT = 'http://gateway.test' + CHATBOT_SYSTEM_PROMPT_PATH;

function mockFetch(impl) {
  globalThis.fetch = impl;
}

test('default prompt mentions the GI bleeding role', () => {
  assert.ok(DEFAULT_CHATBOT_SYSTEM_PROMPT.includes('GI bleeding'));
  assert.equal(getDefaultChatbotSystemPrompt(), DEFAULT_CHATBOT_SYSTEM_PROMPT);
});

test('fetch returns the stored server value', async () => {
  mockFetch(async () => ({ ok: true, json: async () => ({ systemPrompt: 'Shared prompt' }) }));
  assert.equal(await fetchSharedChatbotSystemPrompt(ENDPOINT), 'Shared prompt');
});

test('fetch falls back to the default when the server value is null', async () => {
  mockFetch(async () => ({ ok: true, json: async () => ({ systemPrompt: null }) }));
  assert.equal(await fetchSharedChatbotSystemPrompt(ENDPOINT), getDefaultChatbotSystemPrompt());
});

test('fetch falls back to the default on a non-ok response', async () => {
  mockFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.equal(await fetchSharedChatbotSystemPrompt(ENDPOINT), getDefaultChatbotSystemPrompt());
});

test('fetch falls back to the default on a network error', async () => {
  mockFetch(async () => { throw new Error('offline'); });
  assert.equal(await fetchSharedChatbotSystemPrompt(ENDPOINT), getDefaultChatbotSystemPrompt());
});

test('save PUTs the value and returns the saved string', async () => {
  let captured;
  mockFetch(async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => ({ systemPrompt: 'New prompt' }) };
  });
  const result = await saveSharedChatbotSystemPrompt(ENDPOINT, 'New prompt');
  assert.equal(result, 'New prompt');
  assert.equal(captured.url, ENDPOINT);
  assert.equal(captured.options.method, 'PUT');
  assert.deepEqual(JSON.parse(captured.options.body), { systemPrompt: 'New prompt' });
});

test('save throws on a non-ok response', async () => {
  mockFetch(async () => ({ ok: false, status: 500 }));
  await assert.rejects(() => saveSharedChatbotSystemPrompt(ENDPOINT, 'x'));
});
