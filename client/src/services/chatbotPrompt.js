// Shared (deployed) assistant configuration: the instructions plus the reference
// documents they depend on.
//
// The instructions panel edits a local copy. Deploying pushes that copy to the
// backend, which is what every chatbot frontend loads at startup — so the text
// the panel shows and the text the deployed apps run stay the same without a
// client rebuild.
//
// Documents travel with the prompt rather than staying in the authoring browser.
// They are two halves of one authored artifact: instructions that say "use the
// attached papers" are not the same assistant without the papers, so publishing
// one without the other produced a lecture site confidently citing material it
// had never been given.
//
// The deploy is unauthenticated by design: the editor ships only on the text-chat
// kiosk build, which has no sign-in, and anyone who can open that page may change
// the instructions. Staging only.
import { resolveApiPath } from '@/lib/runtimeConfig';
import { normalizeChatbotDocuments } from '@/lib/chatbotDocuments';
import { DEFAULT_CHATBOT_CATEGORY, normalizeChatbotCategory } from '@/lib/chatbotCategory';

const PROMPT_PATH = '/api/chatbot/system-prompt';
const CATEGORIES_PATH = '/api/chatbot/system-prompt/categories';

// Each category is a separate stored assistant, so every call names one. The
// server validates the id again — this is for the editor, so a bad id fails
// before a deploy rather than after it.
function promptUrl(category) {
  const normalized = normalizeChatbotCategory(category);
  if (!normalized) throw new Error('Use lowercase letters, numbers and hyphens for the lecture id.');
  return `${resolveApiPath(PROMPT_PATH)}?category=${encodeURIComponent(normalized)}`;
}

/**
 * The deployed prompt and documents for one category, or empty values when
 * nothing has been deployed to it yet (the caller then keeps its built-in
 * default). Never throws — startup must not depend on this.
 */
export async function fetchDeployedChatbotSystemPrompt(
  { category = DEFAULT_CHATBOT_CATEGORY } = {},
  fetchImpl = fetch,
) {
  const empty = { category: normalizeChatbotCategory(category), prompt: '', documents: [], updatedAt: '' };
  try {
    const response = await fetchImpl(promptUrl(category), { cache: 'no-store' });
    if (!response.ok) return empty;
    const data = await response.json();
    return {
      category: data?.category || empty.category,
      prompt: typeof data?.prompt === 'string' ? data.prompt : '',
      documents: normalizeChatbotDocuments(data?.documents),
      updatedAt: data?.updatedAt || '',
    };
  } catch {
    return empty;
  }
}

/**
 * The categories that have something deployed to them — what the editor offers
 * as the lectures already set up. Never throws: an unreachable list must not
 * stop someone deploying to a category they can type in by hand.
 */
export async function fetchChatbotPromptCategories(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(resolveApiPath(CATEGORIES_PATH), { cache: 'no-store' });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data?.categories)) return [];
    return data.categories
      .map((entry) => ({
        category: typeof entry?.category === 'string' ? entry.category : '',
        updatedAt: entry?.updatedAt || '',
      }))
      .filter((entry) => entry.category);
  } catch {
    return [];
  }
}

/**
 * Publishes the instructions and their reference documents as what every chatbot
 * frontend loads. Throws on failure.
 */
export async function deployChatbotSystemPrompt(
  { prompt, documents = [], category = DEFAULT_CHATBOT_CATEGORY } = {},
  fetchImpl = fetch,
) {
  const body = String(prompt ?? '');
  const docs = normalizeChatbotDocuments(documents);
  // Documents alone are a publishable assistant: a lecturer who just wants the
  // papers answered from should not have to invent instructions first. The
  // frontends fall back to their neutral built-in instructions when the deployed
  // prompt is empty, so a documents-only deploy still runs a sane assistant.
  if (!body.trim() && docs.length === 0) {
    throw new Error('Add instructions or at least one reference document.');
  }

  const response = await fetchImpl(promptUrl(category), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ prompt: body, documents: docs }),
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
