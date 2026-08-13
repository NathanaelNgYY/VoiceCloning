// Shared (deployed) assistant instructions.
//
// The instructions panel edits a local copy. Deploying pushes that copy to the
// backend, which is what every chatbot frontend loads at startup — so the text
// the panel shows and the text the deployed apps run stay the same without a
// client rebuild.
import { acquireApiToken, shouldAttachApiToken } from '@/auth/msalClient';
import { resolveApiPath } from '@/lib/runtimeConfig';

const PROMPT_PATH = '/api/chatbot/system-prompt';

// The text-chat distribution ships no sign-in, so a deploy from there proves
// itself with the shared key instead. Remembered per browser so it is asked for
// once, not on every deploy.
export const DEPLOY_KEY_STORAGE_KEY = 'chatbot.deployKey';

export function getStoredDeployKey() {
  try {
    return globalThis.localStorage.getItem(DEPLOY_KEY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function storeDeployKey(value) {
  try {
    globalThis.localStorage.setItem(DEPLOY_KEY_STORAGE_KEY, String(value ?? ''));
  } catch {
    // Best-effort; the key is then asked for again next time.
  }
}

async function authHeaders(deployKey = '') {
  const headers = {};
  const key = deployKey || getStoredDeployKey();
  if (key) headers['X-VCS-Deploy-Key'] = key;
  if (!shouldAttachApiToken()) return headers;
  try {
    const token = await acquireApiToken();
    if (token) headers['X-VCS-Entra-Token'] = token;
  } catch {
    // Let the request go out with whatever credential we do have; the backend decides.
  }
  return headers;
}

/**
 * The deployed prompt, or '' when nothing has been deployed yet (the caller then
 * keeps its built-in default). Never throws — startup must not depend on this.
 */
export async function fetchDeployedChatbotSystemPrompt(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(resolveApiPath(PROMPT_PATH), { cache: 'no-store' });
    if (!response.ok) return { prompt: '', updatedAt: '', updatedBy: '' };
    const data = await response.json();
    return {
      prompt: typeof data?.prompt === 'string' ? data.prompt : '',
      updatedAt: data?.updatedAt || '',
      updatedBy: data?.updatedBy || '',
    };
  } catch {
    return { prompt: '', updatedAt: '', updatedBy: '' };
  }
}

/** Publishes `prompt` as the instructions every chatbot frontend loads. Throws on failure. */
export async function deployChatbotSystemPrompt(prompt, { fetchImpl = fetch, deployKey = '' } = {}) {
  const body = String(prompt ?? '');
  if (!body.trim()) {
    throw new Error('Instructions cannot be empty.');
  }

  const response = await fetchImpl(resolveApiPath(PROMPT_PATH), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders(deployKey)) },
    credentials: 'same-origin',
    body: JSON.stringify({ prompt: body }),
  });

  if (!response.ok) {
    let message = `Deploy failed (${response.status}).`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      // Keep the status-code message.
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return response.json().catch(() => ({}));
}
