export const DEFAULT_LIVE_FAST_SETTINGS = {
  speed: 1.0,
  topK: 5,
  topP: 0.85,
  temperature: 0.7,
  repPenalty: 1.35,
};

function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function integerInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

export function normalizeLiveFastSettings(settings = {}) {
  return {
    speed: numberInRange(settings.speed, 0.5, 2.0, DEFAULT_LIVE_FAST_SETTINGS.speed),
    topK: integerInRange(settings.topK, 1, 50, DEFAULT_LIVE_FAST_SETTINGS.topK),
    topP: numberInRange(settings.topP, 0, 1, DEFAULT_LIVE_FAST_SETTINGS.topP),
    temperature: numberInRange(settings.temperature, 0, 1, DEFAULT_LIVE_FAST_SETTINGS.temperature),
    repPenalty: numberInRange(settings.repPenalty, 1.0, 2.0, DEFAULT_LIVE_FAST_SETTINGS.repPenalty),
  };
}

export function buildLiveFastRefParams({
  primaryPath = '',
  promptText = '',
  promptLang = 'en',
  auxRefAudios = [],
  settings = DEFAULT_LIVE_FAST_SETTINGS,
} = {}) {
  if (!primaryPath) return null;

  const normalized = normalizeLiveFastSettings(settings);
  return {
    ref_audio_path: primaryPath,
    prompt_text: promptText || '',
    prompt_lang: promptLang || 'en',
    aux_ref_audio_paths: Array.from(auxRefAudios || [])
      .map((file) => file?.path)
      .filter(Boolean)
      .slice(0, 5),
    speed_factor: normalized.speed,
    top_k: normalized.topK,
    top_p: normalized.topP,
    temperature: normalized.temperature,
    repetition_penalty: normalized.repPenalty,
  };
}

function fallbackReferenceFilename(filePath) {
  return String(filePath || '').replace(/\\/g, '/').split('/').pop() || 'reference.wav';
}

function normalizeReferencePreviewItem(file, role, transcriptFallback = '') {
  if (!file?.path) return null;
  return {
    role,
    path: file.path,
    filename: file.filename || file.name || fallbackReferenceFilename(file.path),
    transcript: file.transcript || transcriptFallback || '',
  };
}

export function buildLiveFastReferencePreviewItems({
  primaryPath = '',
  promptText = '',
  trainingAudioFiles = [],
  auxRefAudios = [],
} = {}) {
  const trainingByPath = new Map(
    Array.from(trainingAudioFiles || [])
      .filter((file) => file?.path)
      .map((file) => [file.path, file])
  );
  const items = [];

  if (primaryPath) {
    const primaryFile = trainingByPath.get(primaryPath) || { path: primaryPath };
    const primaryItem = normalizeReferencePreviewItem(primaryFile, 'primary', promptText);
    if (primaryItem) items.push(primaryItem);
  }

  for (const auxFile of Array.from(auxRefAudios || []).slice(0, 5)) {
    if (!auxFile?.path || auxFile.path === primaryPath) continue;
    const sourceFile = trainingByPath.get(auxFile.path) || auxFile;
    const auxItem = normalizeReferencePreviewItem(sourceFile, 'auxiliary');
    if (auxItem) items.push(auxItem);
  }

  return items;
}
