// Shared (deployed) assistant instructions.
//
// The instructions panel edits a local copy. Deploying pushes that copy to the
// backend, which is what every chatbot frontend loads at startup — so the text
// the panel shows and the text the deployed apps run stay the same without a
// client rebuild.
//
// The deploy is unauthenticated by design: the editor ships only on the text-chat
// kiosk build, which has no sign-in, and anyone who can open that page may change
// the instructions. Staging only.
import { resolveApiPath } from '@/lib/runtimeConfig';

const PROMPT_PATH = '/api/chatbot/system-prompt';

/**
 * The deployed prompt, or '' when nothing has been deployed yet (the caller then
 * keeps its built-in default). Never throws — startup must not depend on this.
 */
export async function fetchDeployedChatbotSystemPrompt(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(resolveApiPath(PROMPT_PATH), { cache: 'no-store' });
    if (!response.ok) return { prompt: '', updatedAt: '' };
    const data = await response.json();
    return {
      prompt: typeof data?.prompt === 'string' ? data.prompt : '',
      updatedAt: data?.updatedAt || '',
    };
  } catch {
    return { prompt: '', updatedAt: '' };
  }
}

/** Publishes `prompt` as the instructions every chatbot frontend loads. Throws on failure. */
export async function deployChatbotSystemPrompt(prompt, fetchImpl = fetch) {
  const body = String(prompt ?? '');
  if (!body.trim()) {
    throw new Error('Instructions cannot be empty.');
  }

  const response = await fetchImpl(resolveApiPath(PROMPT_PATH), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
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
