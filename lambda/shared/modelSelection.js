import { inferenceGet, inferencePost } from './gpuWorker.js';

export function modelSource() {
  return (process.env.MODEL_SOURCE || 's3').trim().toLowerCase();
}

export function useGpuWorkerModels() {
  return ['gpu-worker', 'gpu', 'local', 'gpt-sovits'].includes(modelSource());
}

export async function loadModelPair({
  gptKey = '',
  gptPath = '',
  sovitsKey = '',
  sovitsPath = '',
} = {}) {
  const resolvedGptKey = gptKey || gptPath;
  const resolvedSovitsKey = sovitsKey || sovitsPath;

  let lastStatus = null;
  if (useGpuWorkerModels()) {
    if (resolvedSovitsKey) {
      lastStatus = await inferencePost('/inference/weights/sovits', { weightsPath: resolvedSovitsKey });
    }
    if (resolvedGptKey) {
      lastStatus = await inferencePost('/inference/weights/gpt', { weightsPath: resolvedGptKey });
    }
    return {
      message: 'Models loaded successfully',
      loaded: lastStatus?.loaded || {},
    };
  }

  if (resolvedSovitsKey) {
    const { localPath } = await inferencePost('/models/download', { s3Key: resolvedSovitsKey });
    lastStatus = await inferencePost('/inference/weights/sovits', { weightsPath: localPath });
  }
  if (resolvedGptKey) {
    const { localPath } = await inferencePost('/models/download', { s3Key: resolvedGptKey });
    lastStatus = await inferencePost('/inference/weights/gpt', { weightsPath: localPath });
  }

  return {
    message: 'Models loaded successfully',
    loaded: lastStatus?.loaded || {},
  };
}

export async function ensureProfileModelsLoaded(profile, {
  getStatus = inferenceGet,
  loadModels = loadModelPair,
} = {}) {
  const gptRef = String(profile?.gptKey || profile?.gptPath || '').trim();
  const sovitsRef = String(profile?.sovitsKey || profile?.sovitsPath || '').trim();

  if (!gptRef && !sovitsRef) {
    return { message: 'No model references provided', loaded: {} };
  }

  if (useGpuWorkerModels()) {
    const status = await getStatus('/inference/status');
    const loaded = status?.loaded || {};
    if (loaded.gptPath === gptRef && loaded.sovitsPath === sovitsRef) {
      return {
        message: 'Models already loaded',
        loaded,
      };
    }
  }

  return loadModels(profile);
}
