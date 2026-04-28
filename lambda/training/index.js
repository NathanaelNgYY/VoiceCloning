import { gpuPost, gpuGet } from '../shared/gpuWorker.js';
import { isSafePathSegment } from '../shared/paths.js';
import { ok, err, preflight, parseJsonBody } from '../shared/cors.js';

function isWorkerUnavailableError(error) {
  const message = error?.message || '';
  return error instanceof TypeError
    || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|GPU_WORKER_URL env var/u.test(message);
}

export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return preflight();
  }

  const method = event.requestContext?.http?.method;
  const routePath = event.rawPath || '';
  let body = {};
  if (method === 'POST') {
    try {
      body = parseJsonBody(event);
    } catch {
      return err(400, 'Invalid JSON body');
    }
  }

  try {
    if (method === 'POST' && routePath.endsWith('/train/stop')) {
      const { sessionId } = body;
      if (!sessionId) return err(400, 'sessionId is required');
      return ok(await gpuPost('/train/stop', { sessionId }));
    }

    if (method === 'POST' && routePath.endsWith('/train')) {
      const {
        expName,
        batchSize,
        sovitsEpochs,
        gptEpochs,
        sovitsSaveEvery,
        gptSaveEvery,
        asrLanguage,
        asrModel,
      } = body;
      if (!expName) return err(400, 'expName is required');
      if (!isSafePathSegment(expName)) {
        return err(400, 'expName may only contain letters, numbers, dots, dashes, and underscores');
      }

      return ok(await gpuPost('/train', {
        expName,
        config: {
          ...(batchSize !== undefined ? { batchSize } : {}),
          ...(sovitsEpochs !== undefined ? { sovitsEpochs } : {}),
          ...(gptEpochs !== undefined ? { gptEpochs } : {}),
          ...(sovitsSaveEvery !== undefined ? { sovitsSaveEvery } : {}),
          ...(gptSaveEvery !== undefined ? { gptSaveEvery } : {}),
          ...(asrLanguage !== undefined ? { asrLanguage } : {}),
          ...(asrModel !== undefined ? { asrModel } : {}),
        },
      }));
    }

    if (method === 'GET' && routePath.endsWith('/train/current')) {
      try {
        return ok(await gpuGet('/train/current'));
      } catch (error) {
        if (!isWorkerUnavailableError(error)) {
          throw error;
        }
        return ok({
          sessionId: null,
          status: 'idle',
          steps: [],
          logs: [],
          workerAvailable: false,
          message: error.message,
        });
      }
    }

    return err(404, 'Not found');
  } catch (error) {
    return err(500, error.message);
  }
};
