export const INFERENCE_REFERENCE_PRESETS_KEY = 'voice-cloning-reference-presets';

function getFallbackName(filePath) {
  return (filePath || '').replace(/\\/g, '/').split('/').pop() || 'reference';
}

function normalizeReferenceEntry(entry) {
  if (!entry?.path) return null;

  return {
    path: entry.path,
    name: entry.name || getFallbackName(entry.path),
    source: entry.source === 'uploaded' ? 'uploaded' : 'training',
  };
}

export function createReferencePresetName(primaryName, count) {
  return `Set ${count} - ${primaryName || 'Reference'}`;
}

export function createReferencePresetSignature({
  selectedPersonKey = '',
  selectedGPTPath = '',
  selectedSoVITSPath = '',
  primary = null,
  aux = [],
  promptText = '',
  promptLang = 'en',
}) {
  const normalizedPrimary = normalizeReferenceEntry(primary);
  const normalizedAux = aux
    .map(normalizeReferenceEntry)
    .filter(Boolean)
    .sort((a, b) => a.path.localeCompare(b.path));

  return JSON.stringify({
    selectedPersonKey,
    selectedGPTPath,
    selectedSoVITSPath,
    primary: normalizedPrimary,
    aux: normalizedAux.map((entry) => ({
      path: entry.path,
      source: entry.source,
    })),
    promptText: String(promptText || '').trim(),
    promptLang: promptLang || 'en',
  });
}

export function buildReferencePreset({
  id = null,
  name = '',
  selectedPersonKey = '',
  selectedGPTPath = '',
  selectedSoVITSPath = '',
  voiceLabel = '',
  expName = '',
  primary = null,
  aux = [],
  promptText = '',
  promptLang = 'en',
  createdAt = null,
  updatedAt = null,
}) {
  const normalizedPrimary = normalizeReferenceEntry(primary);
  if (!normalizedPrimary) return null;

  const normalizedAux = aux
    .map(normalizeReferenceEntry)
    .filter(Boolean)
    .sort((a, b) => a.path.localeCompare(b.path));

  const now = Date.now();

  return {
    id: id || (globalThis.crypto?.randomUUID?.() || `ref-preset-${now}-${Math.random().toString(36).slice(2, 8)}`),
    name: name || createReferencePresetName(normalizedPrimary.name, 1),
    signature: createReferencePresetSignature({
      selectedPersonKey,
      selectedGPTPath,
      selectedSoVITSPath,
      primary: normalizedPrimary,
      aux: normalizedAux,
      promptText,
      promptLang,
    }),
    selectedPersonKey,
    selectedGPTPath,
    selectedSoVITSPath,
    voiceLabel: voiceLabel || '',
    expName: expName || '',
    primary: normalizedPrimary,
    aux: normalizedAux,
    promptText: String(promptText || ''),
    promptLang: promptLang || 'en',
    createdAt: createdAt || now,
    updatedAt: updatedAt || now,
  };
}

export function parseStoredReferencePresets(rawValue) {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((preset) => buildReferencePreset(preset))
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch {
    return [];
  }
}
