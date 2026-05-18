function slugifyDisplayName(displayName) {
  return String(displayName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildVoiceProfileId(displayName, fallback = 'voice-profile') {
  const slug = slugifyDisplayName(displayName) || fallback;
  return `${slug}-v1`;
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

export function buildVoiceProfilePayload({
  voiceProfileId = '',
  displayName = '',
  selectedGPT = '',
  selectedSoVITS = '',
  refAudioPath = '',
  promptText = '',
  promptLang = 'en',
  auxRefAudioPaths = [],
  defaults = {},
  storageMode = 'local',
} = {}) {
  const payload = {
    voiceProfileId: String(voiceProfileId || '').trim() || buildVoiceProfileId(displayName),
    displayName: String(displayName || '').trim(),
    ref_audio_path: String(refAudioPath || '').trim(),
    prompt_text: String(promptText || ''),
    prompt_lang: String(promptLang || 'en').trim() || 'en',
    aux_ref_audio_paths: Array.isArray(auxRefAudioPaths)
      ? auxRefAudioPaths.filter(Boolean)
      : [],
    defaults: normalizeDefaults(defaults),
  };

  if (storageMode === 's3') {
    return {
      ...payload,
      gptKey: String(selectedGPT || '').trim(),
      sovitsKey: String(selectedSoVITS || '').trim(),
    };
  }

  return {
    ...payload,
    gptPath: String(selectedGPT || '').trim(),
    sovitsPath: String(selectedSoVITS || '').trim(),
  };
}
