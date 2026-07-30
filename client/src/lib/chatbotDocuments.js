export const CHATBOT_DOCUMENTS_STORAGE_KEY = 'chatbot.documents';
export const MAX_DOCUMENTS_CHARS = 180000;

export function resolveChatbotDocuments() {
  try {
    const raw = globalThis.localStorage.getItem(CHATBOT_DOCUMENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((d) => d && typeof d.name === 'string' && typeof d.text === 'string')
      .map((d) => ({
        name: d.name,
        text: d.text,
        chars: typeof d.chars === 'number' ? d.chars : d.text.length,
      }));
  } catch {
    return [];
  }
}

export function persistChatbotDocuments(docs) {
  try {
    globalThis.localStorage.setItem(
      CHATBOT_DOCUMENTS_STORAGE_KEY,
      JSON.stringify(Array.isArray(docs) ? docs : []),
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function clearChatbotDocuments() {
  try {
    globalThis.localStorage.removeItem(CHATBOT_DOCUMENTS_STORAGE_KEY);
  } catch {
    // best-effort
  }
}

export function addChatbotDocument(docs, doc) {
  const list = Array.isArray(docs) ? docs : [];
  const without = list.filter((d) => d.name !== doc.name);
  return [...without, { name: doc.name, text: doc.text, chars: doc.chars }];
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

export function combineSystemPromptWithDocuments(prompt, docsContext) {
  const base = typeof prompt === 'string' ? prompt : '';
  const ctx = typeof docsContext === 'string' ? docsContext : '';
  if (!ctx) return base;
  return `${base}\n\n${ctx}`;
}
