export function createTtsHistoryItem({
  route,
  url,
  text,
  voiceName = '',
  languageLabel = '',
  sessionId = '',
  chunks = [],
  now = () => new Date(),
}) {
  const createdAt = now();
  const timestamp = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  // Queue routes ('fastQueued' / 'fullQueued') must land in the same output panel as
  // their non-queued counterpart, so collapse them to the base engine here.
  const normalizedRoute = route === 'full' || route === 'fullQueued' ? 'full' : 'fast';
  return {
    id: `${normalizedRoute}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    route: normalizedRoute,
    url,
    text: String(text || '').trim(),
    voiceName,
    languageLabel,
    sessionId,
    chunks: Array.isArray(chunks) ? chunks : [],
    createdAt: timestamp,
    filename: normalizedRoute === 'full' ? 'full_inference_tts.wav' : 'live_fast_tts.wav',
  };
}

export function addTtsHistoryItem(history, item) {
  return [item, ...(Array.isArray(history) ? history : [])];
}

export function getTtsHistoryByRoute(history, route) {
  return (Array.isArray(history) ? history : []).filter((item) => item.route === route);
}
