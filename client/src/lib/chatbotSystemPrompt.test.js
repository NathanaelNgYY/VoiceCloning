import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHATBOT_SYSTEM_PROMPT_STORAGE_KEY,
  DEFAULT_CHATBOT_SYSTEM_PROMPT,
  clearChatbotSystemPrompt,
  getDefaultChatbotSystemPrompt,
  persistChatbotSystemPrompt,
  resolveChatbotSystemPrompt,
} from './chatbotSystemPrompt.js';

describe('chatbotSystemPrompt', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('default prompt mentions the GI bleeding role', () => {
    expect(DEFAULT_CHATBOT_SYSTEM_PROMPT).toContain('GI bleeding');
    expect(getDefaultChatbotSystemPrompt()).toBe(DEFAULT_CHATBOT_SYSTEM_PROMPT);
  });

  it('resolves to the default when nothing is stored', () => {
    expect(resolveChatbotSystemPrompt()).toBe(getDefaultChatbotSystemPrompt());
  });

  it('persists and resolves a stored override', () => {
    persistChatbotSystemPrompt('Custom prompt');
    expect(window.localStorage.getItem(CHATBOT_SYSTEM_PROMPT_STORAGE_KEY)).toBe('Custom prompt');
    expect(resolveChatbotSystemPrompt()).toBe('Custom prompt');
  });

  it('clear() restores the default', () => {
    persistChatbotSystemPrompt('Custom prompt');
    clearChatbotSystemPrompt();
    expect(window.localStorage.getItem(CHATBOT_SYSTEM_PROMPT_STORAGE_KEY)).toBeNull();
    expect(resolveChatbotSystemPrompt()).toBe(getDefaultChatbotSystemPrompt());
  });

  it('does not throw when localStorage access fails', () => {
    vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => persistChatbotSystemPrompt('x')).not.toThrow();
  });
});
