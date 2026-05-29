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
  refAudioPath = '',
  auxRefAudioPaths = [],
} = {}) {
  const primaryPath = String(refAudioPath || '').trim();
  if (!primaryPath) {
    return {};
  }

  return {
    ref_audio_path: primaryPath,
    aux_ref_audio_paths: Array.from(auxRefAudioPaths || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 5),
  };
}
