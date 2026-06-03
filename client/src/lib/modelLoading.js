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
      && (loadedGPTPath !== gptPath || loadedSoVITSPath !== sovitsPath)
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
