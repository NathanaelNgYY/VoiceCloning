const SAFE_EXP_NAME_RE = /^[A-Za-z0-9._-]+$/u;
const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.wav', '.flac', '.mp3', '.m4a', '.ogg', '.webm', '.mp4']);
const SUPPORTED_ASR_LANGUAGES = new Set(['en', 'zh', 'ja', 'ko', 'auto']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function extensionOf(filename = '') {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

function isIntegerInRange(value, min, max) {
  return Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
}

export function validateTrainingStart({
  expName = '',
  email = '',
  source = '',
  files = [],
  selectedLibraryIds = [],
  batchSize = 2,
  sovitsEpochs = 20,
  gptEpochs = 25,
  sovitsSaveEvery = 4,
  gptSaveEvery = 5,
  asrLanguage = 'en',
} = {}) {
  const errors = [];
  const cleanName = String(expName || '').trim();

  if (!cleanName) {
    errors.push('Enter an experiment name.');
  } else if (!SAFE_EXP_NAME_RE.test(cleanName)) {
    errors.push('Experiment name may only contain letters, numbers, dots, dashes, and underscores.');
  }

  const cleanEmail = String(email || '').trim();
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
    errors.push('Enter a valid email address to receive training notifications.');
  }

  const cleanSource = String(source || '').trim().toLowerCase();
  const fileList = Array.from(files || []);
  const libraryIds = Array.from(selectedLibraryIds || []).map((item) => String(item || '').trim()).filter(Boolean);

  if (cleanSource === 'library') {
    if (libraryIds.length === 0) {
      errors.push('Select at least one shared storage audio file.');
    }
  } else if (fileList.length === 0) {
    errors.push('Upload at least one training audio file.');
  } else {
    const unsupported = fileList.find((file) => !SUPPORTED_AUDIO_EXTENSIONS.has(extensionOf(file?.name || '')));
    if (unsupported) {
      errors.push(`Unsupported audio file: ${unsupported.name || 'unknown file'}. Use WAV, FLAC, MP3, M4A, OGG, WEBM, or MP4.`);
    }
  }

  if (!isIntegerInRange(batchSize, 1, 4)) {
    errors.push('Batch size must be between 1 and 4.');
  }
  if (!isIntegerInRange(sovitsEpochs, 1, 50)) {
    errors.push('SoVITS epochs must be between 1 and 50.');
  }
  if (!isIntegerInRange(gptEpochs, 1, 50)) {
    errors.push('GPT epochs must be between 1 and 50.');
  }
  if (!isIntegerInRange(sovitsSaveEvery, 1, 10)) {
    errors.push('SoVITS save interval must be between 1 and 10.');
  }
  if (!isIntegerInRange(gptSaveEvery, 1, 10)) {
    errors.push('GPT save interval must be between 1 and 10.');
  }
  if (!SUPPORTED_ASR_LANGUAGES.has(String(asrLanguage || '').trim())) {
    errors.push('ASR language must be English, Chinese, Japanese, Korean, or Auto Detect.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
