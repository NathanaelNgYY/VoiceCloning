import { buildVoiceProfileId } from './voiceProfilePayload.js';

const MIN_RESTORABLE_AUX_REFS = 5;

function normalizeModelRef(value) {
  return String(value || '').trim();
}

function normalizeReferencePath(value) {
  return String(value || '').trim();
}

function normalizeReferencePathList(paths = [], { excludePath = '' } = {}) {
  const normalizedExcludePath = normalizeReferencePath(excludePath);
  return Array.isArray(paths)
    ? paths
      .map((item) => normalizeReferencePath(item))
      .filter(Boolean)
      .filter((path) => path !== normalizedExcludePath)
    : [];
}

export function matchesSavedVoiceProfileSelection({
  profile = null,
  voiceProfileId = '',
  selectedGPT = '',
  selectedSoVITS = '',
} = {}) {
  const savedVoiceProfileId = String(profile?.voiceProfileId || '').trim();
  const expectedVoiceProfileId = String(voiceProfileId || '').trim();
  if (!savedVoiceProfileId || !expectedVoiceProfileId || savedVoiceProfileId !== expectedVoiceProfileId) {
    return false;
  }

  const savedGptRef = normalizeModelRef(profile?.gptKey || profile?.gptPath);
  const savedSoVitsRef = normalizeModelRef(profile?.sovitsKey || profile?.sovitsPath);
  const expectedGptRef = normalizeModelRef(selectedGPT);
  const expectedSoVitsRef = normalizeModelRef(selectedSoVITS);

  return Boolean(
    (!expectedGptRef || !savedGptRef || expectedGptRef === savedGptRef)
    && (!expectedSoVitsRef || !savedSoVitsRef || expectedSoVitsRef === savedSoVitsRef)
  );
}

export function hasRestorableSavedVoiceProfile(profile = null) {
  const refAudioPath = String(profile?.ref_audio_path || '').trim();
  const auxRefAudioPaths = normalizeReferencePathList(profile?.aux_ref_audio_paths, { excludePath: refAudioPath });

  return Boolean(refAudioPath && auxRefAudioPaths.length >= MIN_RESTORABLE_AUX_REFS);
}

export function matchesSavedVoiceProfileReferenceSelection({
  profile = null,
  refAudioPath = '',
  auxRefAudioPaths = [],
} = {}) {
  const savedPrimaryPath = normalizeReferencePath(profile?.ref_audio_path);
  const currentPrimaryPath = normalizeReferencePath(refAudioPath);
  if (!savedPrimaryPath || savedPrimaryPath !== currentPrimaryPath) {
    return false;
  }

  const savedAuxRefAudioPaths = normalizeReferencePathList(profile?.aux_ref_audio_paths, {
    excludePath: savedPrimaryPath,
  });
  const currentAuxReferencePaths = normalizeReferencePathList(auxRefAudioPaths, {
    excludePath: savedPrimaryPath,
  });

  return (
    savedAuxRefAudioPaths.length === currentAuxReferencePaths.length
    && savedAuxRefAudioPaths.every((path, index) => path === currentAuxReferencePaths[index])
  );
}

export function buildSavedVoiceProfileRestoreKey(profile = null) {
  const voiceProfileId = String(profile?.voiceProfileId || '').trim();
  if (!voiceProfileId) {
    return '';
  }

  const auxRefAudioPaths = normalizeReferencePathList(profile?.aux_ref_audio_paths, {
    excludePath: profile?.ref_audio_path,
  });

  return JSON.stringify({
    voiceProfileId,
    refAudioPath: String(profile?.ref_audio_path || '').trim(),
    auxRefAudioPaths,
    promptText: String(profile?.prompt_text || ''),
    promptLang: String(profile?.prompt_lang || 'en').trim() || 'en',
    textLang: String(profile?.text_lang || 'en').trim() || 'en',
    defaults: profile?.defaults || {},
    updatedAt: String(profile?.updatedAt || ''),
    activatedAt: String(profile?.activatedAt || ''),
  });
}

export function findSavedVoiceProfileKey(profiles = [], voiceProfileId = '') {
  const expectedVoiceProfileId = String(voiceProfileId || '').trim();
  if (!expectedVoiceProfileId || !Array.isArray(profiles)) {
    return '';
  }

  const match = profiles.find((profile) => (
    buildVoiceProfileId(profile?.displayName || '') === expectedVoiceProfileId
  ));

  return match?.key || '';
}
