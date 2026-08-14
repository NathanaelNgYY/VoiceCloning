export const CHATBOT_SYSTEM_PROMPT_STORAGE_KEY = 'chatbot.systemPrompt';

// Starter instructions, used only when no prompt has been deployed yet (or the
// deployed-prompt fetch came back empty). Deliberately subject-free.
//
// This platform serves lectures from any specialty, so nothing here — and nothing
// anywhere else on the request path — may name a subject. A lecturer's deployed
// prompt is the whole prompt: what they author on the faculty site is byte-for-byte
// what the lecture site runs. The GI bleeding text that used to live here is kept
// as reference material in lib/giBleedingPromptTemplate.js and is imported by
// nothing.
export const DEFAULT_CHATBOT_SYSTEM_PROMPT = `You are a teaching assistant for this lecture.

Answer the student's questions using the lesson material provided to you.

Explain things clearly and in plain language, and introduce technical terms as you use them.

If you do not have enough information to answer, say so plainly rather than guessing.`;

// The prompt deployed from the instructions panel, once the app has loaded it.
// It outranks the constant above so a deploy reaches every browser without a
// client rebuild; the constant stays as the offline/first-run fallback.
let deployedPrompt = '';

export function setDeployedChatbotSystemPrompt(value) {
  deployedPrompt = typeof value === 'string' ? value : '';
}

export function getDeployedChatbotSystemPrompt() {
  return deployedPrompt;
}

/**
 * The prompt shipped in this bundle, ignoring anything deployed. This is what
 * "Reset to default" restores: the point of that button is to get back to the
 * blank-slate starter after an experiment, so it must never hand back the
 * deployed text it is undoing.
 */
export function getBundledChatbotSystemPrompt() {
  const envValue = (import.meta.env?.VITE_CHATBOT_SYSTEM_PROMPT || '').trim();
  return envValue || DEFAULT_CHATBOT_SYSTEM_PROMPT;
}

/** What a fresh browser should run: the deployed prompt, else the bundled one. */
export function getDefaultChatbotSystemPrompt() {
  if (deployedPrompt.trim()) return deployedPrompt;
  return getBundledChatbotSystemPrompt();
}

/** True when this browser has a local edit that differs from the deployed text. */
export function hasStoredChatbotSystemPrompt() {
  try {
    const stored = globalThis.localStorage.getItem(CHATBOT_SYSTEM_PROMPT_STORAGE_KEY);
    return typeof stored === 'string' && stored.length > 0;
  } catch {
    return false;
  }
}

/**
 * The prompt this browser should use.
 *
 * `allowLocalOverride` must be false on any build without an instructions editor:
 * there the local copy can only be a stale leftover, and letting it win would
 * silently pin that browser to an old prompt while every deploy passes it by.
 */
export function resolveChatbotSystemPrompt({ allowLocalOverride = true } = {}) {
  if (allowLocalOverride) {
    try {
      const stored = globalThis.localStorage.getItem(CHATBOT_SYSTEM_PROMPT_STORAGE_KEY);
      if (typeof stored === 'string' && stored.length > 0) {
        return stored;
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — fall back to default.
    }
  }
  return getDefaultChatbotSystemPrompt();
}

export function persistChatbotSystemPrompt(value) {
  try {
    globalThis.localStorage.setItem(CHATBOT_SYSTEM_PROMPT_STORAGE_KEY, String(value ?? ''));
  } catch {
    // Best-effort; ignore persistence failures.
  }
}

export function clearChatbotSystemPrompt() {
  try {
    globalThis.localStorage.removeItem(CHATBOT_SYSTEM_PROMPT_STORAGE_KEY);
  } catch {
    // Best-effort; ignore removal failures.
  }
}
