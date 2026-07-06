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

// Weights filename, lower-cased, ignoring directory/format. The inference server
// may report an absolute filesystem path ("/opt/gpt-sovits/.../Dean-e10.ckpt")
// while the client tracks the S3 key ("models/user-models/gpt/Dean-e10.ckpt") for
// the same model — comparing basenames avoids a spurious "different model".
function weightsBasename(path) {
  return String(path || '').trim().split(/[\\/]/).pop().toLowerCase();
}

function reconcileLoadedPath(reported, fallback) {
  const reportedTrim = String(reported || '').trim();
  const fallbackTrim = String(fallback || '').trim();
  // Blank report → keep what we already know is loaded (benign blank, respawn,
  // different worker instance). This stopped the false "No model" flaps.
  if (!reportedTrim) return fallbackTrim;
  // Same model, different path format → keep the canonical value we selected so
  // the "is my selection loaded?" check still matches.
  if (fallbackTrim && weightsBasename(reportedTrim) === weightsBasename(fallbackTrim)) {
    return fallbackTrim;
  }
  // Genuinely different, populated model (e.g. another session switched it).
  return reportedTrim;
}

export function resolveInferenceStatusState({
  status = {},
  fallbackLoadedGPTPath = '',
  fallbackLoadedSoVITSPath = '',
} = {}) {
  return {
    serverReady: Boolean(status?.ready),
    loadedGPTPath: reconcileLoadedPath(status?.loaded?.gptPath, fallbackLoadedGPTPath),
    loadedSoVITSPath: reconcileLoadedPath(status?.loaded?.sovitsPath, fallbackLoadedSoVITSPath),
  };
}
