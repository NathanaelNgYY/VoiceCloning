function fallbackName(filePath = '') {
  return String(filePath || '').replace(/\\/g, '/').split('/').pop() || '';
}

function normalizeDefaults(defaults = {}) {
  return {
    ...(defaults.top_k !== undefined ? { top_k: defaults.top_k } : {}),
    ...(defaults.top_p !== undefined ? { top_p: defaults.top_p } : {}),
    ...(defaults.temperature !== undefined ? { temperature: defaults.temperature } : {}),
    ...(defaults.repetition_penalty !== undefined ? { repetition_penalty: defaults.repetition_penalty } : {}),
    ...(defaults.speed_factor !== undefined ? { speed_factor: defaults.speed_factor } : {}),
  };
}

export function createVoiceProfileBrowserDebugSummary({
  context = '',
  voiceProfileId = '',
  displayName = '',
  selectedExpName = '',
  refAudioPath = '',
  promptText = '',
  promptLang = 'en',
  textLang = 'en',
  auxRefAudioPaths = [],
  defaults = {},
  summary = null,
} = {}) {
  const auxPaths = Array.isArray(auxRefAudioPaths) ? auxRefAudioPaths.filter(Boolean) : [];

  return {
    context,
    voiceProfileId: String(voiceProfileId || '').trim(),
    displayName: String(displayName || '').trim(),
    selectedExpName: String(selectedExpName || '').trim(),
    primary: {
      path: String(refAudioPath || '').trim(),
      filename: fallbackName(refAudioPath),
    },
    auxCount: auxPaths.length,
    aux: auxPaths.map((path) => ({
      path,
      filename: fallbackName(path),
    })),
    promptText: String(promptText || ''),
    promptLang: String(promptLang || 'en').trim() || 'en',
    textLang: String(textLang || 'en').trim() || 'en',
    defaults: normalizeDefaults(defaults),
    summary: summary ? {
      voiceProfileId: String(summary.voiceProfileId || '').trim(),
      displayName: String(summary.displayName || '').trim(),
      activatedAt: String(summary.activatedAt || '').trim(),
    } : null,
  };
}

export function writeVoiceProfileBrowserDebug(label, snapshot) {
  if (typeof window === 'undefined') {
    return null;
  }

  const entry = {
    label: String(label || '').trim() || 'voice-profile-debug',
    at: new Date().toISOString(),
    ...snapshot,
  };

  const history = Array.isArray(window.__VOICE_PROFILE_DEBUG_HISTORY__)
    ? window.__VOICE_PROFILE_DEBUG_HISTORY__
    : [];

  const nextHistory = [...history, entry].slice(-20);
  window.__VOICE_PROFILE_DEBUG__ = entry;
  window.__VOICE_PROFILE_DEBUG_HISTORY__ = nextHistory;

  console.info(`[VoiceProfile] ${entry.label}`, entry);
  return entry;
}
