function normalizeDefaults(defaults = {}) {
  return {
    ...(defaults.top_k !== undefined ? { top_k: defaults.top_k } : {}),
    ...(defaults.top_p !== undefined ? { top_p: defaults.top_p } : {}),
    ...(defaults.temperature !== undefined ? { temperature: defaults.temperature } : {}),
    ...(defaults.repetition_penalty !== undefined ? { repetition_penalty: defaults.repetition_penalty } : {}),
    ...(defaults.speed_factor !== undefined ? { speed_factor: defaults.speed_factor } : {}),
  };
}

export function createAutoVoiceProfileSyncFingerprint({
  sourceKey = '',
  selectedGPT = '',
  selectedSoVITS = '',
  refAudioPath = '',
  promptText = '',
  promptLang = 'en',
  textLang = 'en',
  preferredRoute = 'sentence',
  auxRefAudioPaths = [],
  defaults = {},
} = {}) {
  return JSON.stringify({
    sourceKey: String(sourceKey || '').trim(),
    selectedGPT: String(selectedGPT || '').trim(),
    selectedSoVITS: String(selectedSoVITS || '').trim(),
    refAudioPath: String(refAudioPath || '').trim(),
    promptText: String(promptText || ''),
    promptLang: String(promptLang || 'en').trim() || 'en',
    textLang: String(textLang || 'en').trim() || 'en',
    preferredRoute: String(preferredRoute || 'sentence').trim() || 'sentence',
    auxRefAudioPaths: Array.isArray(auxRefAudioPaths) ? auxRefAudioPaths.filter(Boolean) : [],
    defaults: normalizeDefaults(defaults),
  });
}

export function shouldAutoSyncVoiceProfile({
  pendingFingerprint = '',
  currentFingerprint = '',
  lastSyncedFingerprint = '',
  ready = false,
  busy = false,
  inFlightFingerprint = '',
} = {}) {
  return Boolean(getAutoSyncRequestFingerprint({
    pendingFingerprint,
    currentFingerprint,
    lastSyncedFingerprint,
    ready,
    busy,
    inFlightFingerprint,
  }));
}

export function getAutoSyncRequestFingerprint({
  pendingFingerprint = '',
  currentFingerprint = '',
  lastSyncedFingerprint = '',
  ready = false,
  busy = false,
  inFlightFingerprint = '',
} = {}) {
  return (
    pendingFingerprint
      && currentFingerprint
      && pendingFingerprint === currentFingerprint
      && currentFingerprint !== lastSyncedFingerprint
      && ready
      && !busy
      && !inFlightFingerprint
      ? currentFingerprint
      : ''
  );
}
