export const LIVE_FULL_PIPELINE = 'liveFull';

// Defaults intentionally match DEFAULT_LIVE_FAST_SETTINGS — Live Full inherits
// Live Fast's known-good defaults. User-saved/tweaked configs still take priority.
export const DEFAULT_LIVE_FULL_SETTINGS = {
  speed: 1.0,
  topK: 5,
  topP: 0.85,
  temperature: 0.7,
  repPenalty: 1.35,
  maxChunkWords: 0,
  maxSentencesPerChunk: 2,
};

function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function integerInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

export function normalizeLiveFullSettings(settings = {}) {
  return {
    speed: numberInRange(settings.speed, 0.5, 2.0, DEFAULT_LIVE_FULL_SETTINGS.speed),
    topK: integerInRange(settings.topK, 1, 50, DEFAULT_LIVE_FULL_SETTINGS.topK),
    topP: numberInRange(settings.topP, 0, 1, DEFAULT_LIVE_FULL_SETTINGS.topP),
    temperature: numberInRange(settings.temperature, 0, 1, DEFAULT_LIVE_FULL_SETTINGS.temperature),
    repPenalty: numberInRange(settings.repPenalty, 1.0, 2.0, DEFAULT_LIVE_FULL_SETTINGS.repPenalty),
    maxChunkWords: integerInRange(settings.maxChunkWords, 0, 100, DEFAULT_LIVE_FULL_SETTINGS.maxChunkWords),
    maxSentencesPerChunk: integerInRange(settings.maxSentencesPerChunk, 1, 5, DEFAULT_LIVE_FULL_SETTINGS.maxSentencesPerChunk),
  };
}

export function isLiveFullConfig(config = {}) {
  const metadata = config.inferenceMetadata || {};
  return metadata.pipeline === LIVE_FULL_PIPELINE || metadata.preferredRoute === 'full';
}

export function filterLiveFullConfigs(configs = []) {
  return Array.from(configs || []).filter(isLiveFullConfig);
}

export function filterLiveFastConfigs(configs = []) {
  return Array.from(configs || []).filter((config) => !isLiveFullConfig(config));
}

export function buildLiveFullRefParams({
  primaryPath = '',
  promptText = '',
  promptLang = 'en',
  auxRefAudios = [],
  settings = DEFAULT_LIVE_FULL_SETTINGS,
} = {}) {
  if (!primaryPath) return null;

  const normalized = normalizeLiveFullSettings(settings);
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
    ...(normalized.maxChunkWords > 0 ? { max_chunk_words: normalized.maxChunkWords } : {}),
    max_sentences_per_chunk: normalized.maxSentencesPerChunk,
  };
}

export function buildLiveFullConfigPayload({
  configId = '',
  configName = 'Live Full default',
  rank = 1,
  language = 'en',
  settings = DEFAULT_LIVE_FULL_SETTINGS,
  trainingMetadata = {},
  referenceMetadata = {},
} = {}) {
  const normalized = normalizeLiveFullSettings(settings);
  return {
    ...(configId ? { configId } : {}),
    configName,
    rank,
    selected: true,
    trainingMetadata: trainingMetadata || {},
    inferenceMetadata: {
      pipeline: LIVE_FULL_PIPELINE,
      preferredRoute: 'full',
      configName,
      language,
      defaults: {
        top_k: normalized.topK,
        top_p: normalized.topP,
        temperature: normalized.temperature,
        repetition_penalty: normalized.repPenalty,
        speed_factor: normalized.speed,
        max_chunk_words: normalized.maxChunkWords,
        max_sentences_per_chunk: normalized.maxSentencesPerChunk,
      },
      ...(configId ? { configId } : {}),
    },
    referenceMetadata: referenceMetadata || {},
    sample: {},
  };
}
