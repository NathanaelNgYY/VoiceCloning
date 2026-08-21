export const PENDING_FULL_TTS_STORAGE_KEY = 'vcs.pending-full-tts.v1';
export const PENDING_FULL_TTS_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const SESSION_ID_PATTERN = /^[A-Za-z0-9-]+$/u;
const FULL_ROUTES = new Set(['full', 'fullQueued']);

export function normalizePendingFullTts(value, {
  now = Date.now(),
  maxAgeMs = PENDING_FULL_TTS_MAX_AGE_MS,
} = {}) {
  if (!value || typeof value !== 'object') return null;
  const sessionId = String(value.sessionId || '').trim();
  const route = String(value.route || '').trim();
  const text = String(value.text || '').trim();
  const savedAt = Number(value.savedAt);
  if (!SESSION_ID_PATTERN.test(sessionId) || !FULL_ROUTES.has(route) || !text) return null;
  if (!Number.isFinite(savedAt) || savedAt <= 0 || now - savedAt > maxAgeMs || savedAt > now + 60_000) {
    return null;
  }
  return {
    sessionId,
    route,
    text,
    voiceName: String(value.voiceName || '').trim(),
    languageLabel: String(value.languageLabel || '').trim(),
    totalChunks: Math.max(0, Math.trunc(Number(value.totalChunks) || 0)),
    completedChunks: Math.max(0, Math.trunc(Number(value.completedChunks) || 0)),
    chunks: Array.isArray(value.chunks) ? value.chunks : [],
    currentChunkText: String(value.currentChunkText || ''),
    savedAt,
  };
}

export function loadPendingFullTts(storage = globalThis.sessionStorage, options = {}) {
  try {
    const raw = storage?.getItem(PENDING_FULL_TTS_STORAGE_KEY);
    if (!raw) return null;
    const pending = normalizePendingFullTts(JSON.parse(raw), options);
    if (!pending) storage?.removeItem(PENDING_FULL_TTS_STORAGE_KEY);
    return pending;
  } catch {
    return null;
  }
}

export function savePendingFullTts(value, storage = globalThis.sessionStorage) {
  const pending = normalizePendingFullTts(value, { now: Number(value?.savedAt) || Date.now() });
  if (!pending) return false;
  try {
    storage?.setItem(PENDING_FULL_TTS_STORAGE_KEY, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingFullTts(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem(PENDING_FULL_TTS_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}
