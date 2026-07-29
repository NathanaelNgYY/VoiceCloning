export function normalizeVoiceKey(name) {
  return String(name || '').toLowerCase().replace(/[\s_-]+/g, '');
}

export function resolveInitialVoiceKey({ search = '', envVoiceId = '' } = {}) {
  const params = new URLSearchParams(search);
  const fromUrl = params.get('voice');
  const raw = fromUrl && fromUrl.trim() ? fromUrl : envVoiceId;
  return normalizeVoiceKey(raw);
}
