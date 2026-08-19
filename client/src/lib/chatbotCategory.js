// Which assistant a page is talking about.
//
// A category is one lecture's assistant: its instructions and its reference
// documents. The id is the lecture slug the lecture site already routes on
// (`/lesson/gi-bleeding` → category `gi-bleeding`), so a student's page asks for
// its own assistant with no new concept and no mapping table.
//
// The rules here are duplicated in lambda/chatbot-prompt/index.js on purpose:
// the two packages share no module, and the id lands in an S3 key, so the server
// validates independently rather than trusting this. Keep them in step — the
// same way MAX_DOCUMENTS_CHARS is stated on both sides.

/** What a page with no lecture of its own runs: the standalone kiosks. */
export const DEFAULT_CHATBOT_CATEGORY = 'default';

// Lowercase letters, digits and hyphens. Not a style preference: the id is
// concatenated into an S3 key, so dots and slashes are a path-escape risk.
export const CHATBOT_CATEGORY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export function isValidChatbotCategory(value) {
  return typeof value === 'string' && CHATBOT_CATEGORY_PATTERN.test(value);
}

/**
 * The category to actually use: blank means the default, case is folded (a
 * lecturer typing "GI-Bleeding" must not create a lecture the site can never
 * route to), and anything still invalid returns '' for the caller to reject.
 */
export function normalizeChatbotCategory(value) {
  const trimmed = String(value ?? '').trim().toLowerCase();
  if (!trimmed) return DEFAULT_CHATBOT_CATEGORY;
  return isValidChatbotCategory(trimmed) ? trimmed : '';
}

/**
 * Suffix that scopes a browser-local draft to one category.
 *
 * The default category keeps the original unsuffixed key, so a draft typed
 * before categories existed is still there after the upgrade rather than
 * silently reverting to the deployed text.
 *
 * Scoping is load-bearing: with one shared key, switching category would show
 * the previous lecture's draft, and deploying would publish it under the new
 * lecture's name.
 */
export function chatbotCategoryStorageSuffix(category) {
  const normalized = normalizeChatbotCategory(category);
  if (!normalized || normalized === DEFAULT_CHATBOT_CATEGORY) return '';
  return `:${normalized}`;
}
