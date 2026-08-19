import { chatbotCategoryStorageSuffix } from './chatbotCategory.js';

export const CHATBOT_DOCUMENTS_STORAGE_KEY = 'chatbot.documents';

/**
 * Where this browser's document draft for one category lives. Same reasoning as
 * chatbotSystemPromptStorageKey: an unscoped key would carry one lecture's PDFs
 * into another lecture's deploy.
 */
export function chatbotDocumentsStorageKey(category) {
  return `${CHATBOT_DOCUMENTS_STORAGE_KEY}${chatbotCategoryStorageSuffix(category)}`;
}
export const MAX_DOCUMENTS_CHARS = 180000;

/**
 * One reference document in its canonical shape.
 *
 * `chars` is always derived from `text` rather than trusted from the caller: it
 * is displayed as the size budget in the editor, and a stored count that has
 * drifted from the text would quietly misreport how close a deploy is to the
 * truncation limit.
 */
export function normalizeChatbotDocument(doc) {
  if (!doc || typeof doc.name !== 'string' || typeof doc.text !== 'string') return null;
  return { name: doc.name, text: doc.text, chars: doc.text.length };
}

export function normalizeChatbotDocuments(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.map(normalizeChatbotDocument).filter(Boolean);
}

// The documents deployed from the instructions panel, once the app has loaded
// them. Mirrors the deployed-prompt store in chatbotSystemPrompt.js: the panel
// edits a local copy, deploying publishes it, and every frontend reads the
// published copy at startup.
let deployedDocuments = [];

export function setDeployedChatbotDocuments(docs) {
  deployedDocuments = normalizeChatbotDocuments(docs);
}

export function getDeployedChatbotDocuments() {
  return deployedDocuments;
}

/**
 * True when this browser holds a local edit of the document set.
 *
 * Presence of the key is the signal, not whether it parses to a non-empty list:
 * a lecturer who removes every document has locally chosen "no documents", and
 * that choice has to outrank the deployed set or the deleted files would come
 * back on the next render.
 */
export function hasStoredChatbotDocuments({ category } = {}) {
  try {
    const raw = globalThis.localStorage.getItem(chatbotDocumentsStorageKey(category));
    return typeof raw === 'string' && raw.length > 0;
  } catch {
    return false;
  }
}

/**
 * The documents this browser should use.
 *
 * `allowLocalOverride` must be false on any build without an instructions editor
 * — same rule as resolveChatbotSystemPrompt. There the local copy can only be a
 * stale leftover from before documents were published server-side, and letting
 * it win would pin that browser to documents no lecturer can see or replace.
 */
export function resolveChatbotDocuments({ allowLocalOverride = true, category } = {}) {
  if (allowLocalOverride) {
    try {
      const raw = globalThis.localStorage.getItem(chatbotDocumentsStorageKey(category));
      if (typeof raw === 'string' && raw.length > 0) {
        return normalizeChatbotDocuments(JSON.parse(raw));
      }
    } catch {
      // Unreadable or unparseable — fall through to the deployed set.
    }
  }
  return getDeployedChatbotDocuments();
}

export function persistChatbotDocuments(docs, { category } = {}) {
  try {
    globalThis.localStorage.setItem(
      chatbotDocumentsStorageKey(category),
      JSON.stringify(normalizeChatbotDocuments(docs)),
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function clearChatbotDocuments({ category } = {}) {
  try {
    globalThis.localStorage.removeItem(chatbotDocumentsStorageKey(category));
  } catch {
    // best-effort
  }
}

export function addChatbotDocument(docs, doc) {
  const list = Array.isArray(docs) ? docs : [];
  const normalized = normalizeChatbotDocument(doc);
  if (!normalized) return list;
  const without = list.filter((d) => d.name !== normalized.name);
  return [...without, normalized];
}

export function removeChatbotDocument(docs, name) {
  const list = Array.isArray(docs) ? docs : [];
  return list.filter((d) => d.name !== name);
}

export function buildDocumentsContext(docs, { maxChars = MAX_DOCUMENTS_CHARS } = {}) {
  const list = Array.isArray(docs) ? docs.filter((d) => d && d.text) : [];
  if (list.length === 0) return { text: '', truncated: false, totalChars: 0 };
  const header = '# Uploaded Reference Documents\n'
    + 'Treat the following as additional approved reference material. Use it the '
    + 'same way as the approved material above. Do not invent details beyond it.';
  const body = list.map((d) => `## ${d.name}\n${d.text}`).join('\n\n');
  const full = `${header}\n\n${body}`;
  const totalChars = full.length;
  if (totalChars <= maxChars) return { text: full, truncated: false, totalChars };
  return { text: full.slice(0, maxChars), truncated: true, totalChars };
}
