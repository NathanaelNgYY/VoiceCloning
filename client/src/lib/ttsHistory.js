export function createTtsHistoryItem({
  route,
  url,
  text,
  voiceName = '',
  languageLabel = '',
  now = () => new Date(),
}) {
  const createdAt = now();
  const timestamp = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  const normalizedRoute = route === 'full' ? 'full' : 'fast';
  return {
    id: `${normalizedRoute}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    route: normalizedRoute,
    url,
    text: String(text || '').trim(),
    voiceName,
    languageLabel,
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
