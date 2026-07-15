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
    ...(defaults.max_chunk_words !== undefined ? { max_chunk_words: defaults.max_chunk_words } : {}),
    ...(defaults.max_sentences_per_chunk !== undefined
      ? { max_sentences_per_chunk: defaults.max_sentences_per_chunk }
      : {}),
  };
}

function normalizePreferredRoute(preferredRoute) {
  return String(preferredRoute || '').trim().toLowerCase() === 'full' ? 'full' : 'sentence';
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function compactReferenceItem(item) {
  if (!isPlainObject(item)) return null;
  const path = String(item.path || item.file?.path || '').trim();
  const filename = String(item.filename || item.file?.filename || '').trim();
  const score = Number(item.score);
  return {
    ...(filename ? { filename } : {}),
    ...(path ? { path } : {}),
    ...(Number.isFinite(score) ? { score } : {}),
  };
}

function compactReferenceMetadata(referenceMetadata) {
  if (!isPlainObject(referenceMetadata)) return null;
  const selectedPaths = isPlainObject(referenceMetadata.selectedPaths)
    ? {
        ...(referenceMetadata.selectedPaths.primary ? { primary: referenceMetadata.selectedPaths.primary } : {}),
        ...(Array.isArray(referenceMetadata.selectedPaths.aux)
          ? { aux: referenceMetadata.selectedPaths.aux.filter(Boolean) }
          : {}),
      }
    : null;
  const primary = compactReferenceItem(referenceMetadata.primary);
  const aux = Array.isArray(referenceMetadata.aux)
    ? referenceMetadata.aux.map(compactReferenceItem).filter(Boolean)
    : [];
  const compact = {
    ...(referenceMetadata.mode ? { mode: referenceMetadata.mode } : {}),
    ...(selectedPaths && Object.keys(selectedPaths).length > 0 ? { selectedPaths } : {}),
    ...(primary ? { primary } : {}),
    ...(aux.length > 0 ? { aux } : {}),
  };
  return Object.keys(compact).length > 0 ? compact : null;
}

function normalizeMetadata({ trainingMetadata, referenceMetadata, liveFastMetadata } = {}) {
  const metadata = {
    ...(isPlainObject(trainingMetadata) ? { training: trainingMetadata } : {}),
    ...(compactReferenceMetadata(referenceMetadata) ? { reference: compactReferenceMetadata(referenceMetadata) } : {}),
    ...(isPlainObject(liveFastMetadata) ? { liveFast: liveFastMetadata } : {}),
  };
  return Object.keys(metadata).length > 0 ? metadata : null;
}

export function buildVoiceProfilePayload({
  voiceProfileId = '',
  displayName = '',
  selectedGPT = '',
  selectedSoVITS = '',
  refAudioPath = '',
  promptText = '',
  promptLang = 'en',
  textLang = 'en',
  preferredRoute = 'sentence',
  auxRefAudioPaths = [],
  defaults = {},
  trainingMetadata,
  referenceMetadata,
  liveFastMetadata,
  storageMode = 'local',
} = {}) {
  const metadata = normalizeMetadata({ trainingMetadata, referenceMetadata, liveFastMetadata });
  const payload = {
    voiceProfileId: String(voiceProfileId || '').trim() || buildVoiceProfileId(displayName),
    displayName: String(displayName || '').trim(),
    ref_audio_path: String(refAudioPath || '').trim(),
    prompt_text: String(promptText || ''),
    prompt_lang: String(promptLang || 'en').trim() || 'en',
    text_lang: String(textLang || promptLang || 'en').trim() || String(promptLang || 'en').trim() || 'en',
    preferredRoute: normalizePreferredRoute(preferredRoute),
    aux_ref_audio_paths: Array.isArray(auxRefAudioPaths)
      ? auxRefAudioPaths.filter(Boolean)
      : [],
    defaults: normalizeDefaults(defaults),
    ...(metadata ? { metadata } : {}),
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
