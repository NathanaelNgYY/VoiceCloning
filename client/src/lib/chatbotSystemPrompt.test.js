import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATBOT_SYSTEM_PROMPT_STORAGE_KEY,
  DEFAULT_CHATBOT_SYSTEM_PROMPT,
  clearChatbotSystemPrompt,
  getDefaultChatbotSystemPrompt,
  persistChatbotSystemPrompt,
  resolveChatbotSystemPrompt,
} from './chatbotSystemPrompt.js';

function installMemoryStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
  };
  return store;
}

test('default prompt mentions the GI bleeding role', () => {
  installMemoryStorage();
  assert.ok(DEFAULT_CHATBOT_SYSTEM_PROMPT.includes('GI bleeding'));
  assert.equal(getDefaultChatbotSystemPrompt(), DEFAULT_CHATBOT_SYSTEM_PROMPT);
});

test('resolves to the default when nothing is stored', () => {
  installMemoryStorage();
  assert.equal(resolveChatbotSystemPrompt(), getDefaultChatbotSystemPrompt());
});

test('persists and resolves a stored override', () => {
  installMemoryStorage();
  persistChatbotSystemPrompt('Custom prompt');
  assert.equal(globalThis.localStorage.getItem(CHATBOT_SYSTEM_PROMPT_STORAGE_KEY), 'Custom prompt');
  assert.equal(resolveChatbotSystemPrompt(), 'Custom prompt');
});

test('clear() restores the default', () => {
  installMemoryStorage();
  persistChatbotSystemPrompt('Custom prompt');
  clearChatbotSystemPrompt();
  assert.equal(globalThis.localStorage.getItem(CHATBOT_SYSTEM_PROMPT_STORAGE_KEY), null);
  assert.equal(resolveChatbotSystemPrompt(), getDefaultChatbotSystemPrompt());
});

test('does not throw when localStorage access fails', () => {
  installMemoryStorage();
  globalThis.localStorage.setItem = () => { throw new Error('quota'); };
  assert.doesNotThrow(() => persistChatbotSystemPrompt('x'));
});
