// In S3 mode the client identifies models by S3 key while the worker reports the
// local file it downloaded the key to (model_cache/<basename of the key>), so the
// same loaded weights carry two different paths. The download preserves the key's
// basename, making filename equality the reliable identity across both modes.
export function sameLoadedWeights(selectedPath, loadedPath) {
  const selected = String(selectedPath || '').trim();
  const loaded = String(loadedPath || '').trim();
  if (!selected || !loaded) return false;
  if (selected === loaded) return true;
  return selected.split(/[\\/]/).pop() === loaded.split(/[\\/]/).pop();
}

export function isSelectedModelLoaded({
  serverReady,
  selectedGPT,
  selectedSoVITS,
  loadedGPTPath,
  loadedSoVITSPath,
}) {
  return Boolean(
    serverReady
      && sameLoadedWeights(selectedGPT, loadedGPTPath)
      && sameLoadedWeights(selectedSoVITS, loadedSoVITSPath)
  );
}

export function shouldLoadSelectedProfile({
  selectedProfile,
  loadedGPTPath,
  loadedSoVITSPath,
  isConversationActive,
  loadingModel,
}) {
  const gptPath = selectedProfile?.gptModel?.path || '';
  const sovitsPath = selectedProfile?.sovitsModel?.path || '';

  return Boolean(
    selectedProfile?.complete
      && gptPath
      && sovitsPath
      && !isConversationActive
      && !loadingModel
      && (!sameLoadedWeights(gptPath, loadedGPTPath) || !sameLoadedWeights(sovitsPath, loadedSoVITSPath))
  );
}

export function buildModelSelectWarmPayload({
  voiceProfileId = '',
  refAudioPath = '',
  auxRefAudioPaths = [],
} = {}) {
  const primaryPath = String(refAudioPath || '').trim();
  const normalizedVoiceProfileId = String(voiceProfileId || '').trim();
  if (!primaryPath) {
    return normalizedVoiceProfileId ? { voiceProfileId: normalizedVoiceProfileId } : {};
  }

  return {
    ...(normalizedVoiceProfileId ? { voiceProfileId: normalizedVoiceProfileId } : {}),
    ref_audio_path: primaryPath,
    aux_ref_audio_paths: Array.from(auxRefAudioPaths || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 5),
  };
}

export function extractModelSelectWarmedReferenceSelection(result = {}) {
  const primaryPath = String(result?.warmedReferences?.ref_audio_path || '').trim();
  if (!primaryPath) {
    return null;
  }

  return {
    refAudioPath: primaryPath,
    auxRefAudioPaths: Array.from(result?.warmedReferences?.aux_ref_audio_paths || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .filter((path) => path !== primaryPath)
      .slice(0, 5),
  };
}

export function resolveInferenceStatusState({
  status = {},
  fallbackLoadedGPTPath = '',
  fallbackLoadedSoVITSPath = '',
} = {}) {
  const hasLoadedState = Boolean(status?.loaded && typeof status.loaded === 'object');

  return {
    serverReady: Boolean(status?.ready),
    loadedGPTPath: hasLoadedState
      ? String(status.loaded?.gptPath || '').trim()
      : String(fallbackLoadedGPTPath || '').trim(),
    loadedSoVITSPath: hasLoadedState
      ? String(status.loaded?.sovitsPath || '').trim()
      : String(fallbackLoadedSoVITSPath || '').trim(),
  };
}
