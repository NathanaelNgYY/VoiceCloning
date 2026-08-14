import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATBOT_SYSTEM_PROMPT_STORAGE_KEY,
  DEFAULT_CHATBOT_SYSTEM_PROMPT,
  clearChatbotSystemPrompt,
  getDefaultChatbotSystemPrompt,
  persistChatbotSystemPrompt,
  resolveChatbotSystemPrompt,
  setDeployedChatbotSystemPrompt,
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

test('the starter prompt names no subject', () => {
  installMemoryStorage();
  setDeployedChatbotSystemPrompt('');
  // This platform serves lectures from every specialty, so the text that runs
  // when nothing is deployed must not teach one. A GI bleeding prompt used to
  // live here, which meant a neurology lecture whose prompt fetch came back
  // empty would silently answer as a GI bleeding tutor.
  assert.doesNotMatch(DEFAULT_CHATBOT_SYSTEM_PROMPT, /GI bleeding|gastrointestinal|melena|Forrest/i);
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

test('falls back to the default when localStorage cannot be read', () => {
  installMemoryStorage();
  globalThis.localStorage.getItem = () => { throw new Error('blocked'); };
  assert.equal(resolveChatbotSystemPrompt(), getDefaultChatbotSystemPrompt());
});

test('does not throw when localStorage cannot clear the saved prompt', () => {
  installMemoryStorage();
  globalThis.localStorage.removeItem = () => { throw new Error('blocked'); };
  assert.doesNotThrow(() => clearChatbotSystemPrompt());
});

test('a deployed prompt reaches the lecture site byte-for-byte', () => {
  // The contract the whole platform rests on: a lecturer authors a prompt on the
  // faculty site, deploys it, and the lecture site runs exactly that. Nothing may
  // be wrapped around it. A hardcoded GI bleeding scope gate used to be, so an
  // "Atlas" assistant introduced itself normally on faculty and then answered
  // "I can only help with GI bleeding education and this lesson video." on lectures.
  installMemoryStorage();
  const deployed = 'You are **Atlas**, an AI assistant.\n\nAnswer directly.';
  setDeployedChatbotSystemPrompt(deployed);

  assert.equal(getDefaultChatbotSystemPrompt(), deployed);
  // allowLocalOverride: false is what the lecture site passes — no editor there.
  assert.equal(resolveChatbotSystemPrompt({ allowLocalOverride: false }), deployed);
  setDeployedChatbotSystemPrompt('');
});
