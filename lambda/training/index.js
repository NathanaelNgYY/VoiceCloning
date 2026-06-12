import { gpuPost, gpuGet } from '../shared/gpuWorker.js';
import { isSafePathSegment } from '../shared/paths.js';
import { ok, err, preflight, parseJsonBody } from '../shared/cors.js';
import { getObject, headObject } from '../shared/s3.js';

function isWorkerUnavailableError(error) {
  const message = error?.message || '';
  return error instanceof TypeError
    || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|GPU_WORKER_URL env var/u.test(message);
}

async function defaultReadObject(key) {
  const existing = await headObject(key);
  if (!existing) return null;
  return getObject(key);
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return '';
  }
}

export function createHandler({
  readObject = defaultReadObject,
} = {}) {
  return async function trainingHandler(event) {
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
        email,
        batchSize,
        sovitsEpochs,
        gptEpochs,
        sovitsSaveEvery,
        gptSaveEvery,
        asrLanguage,
        asrModel,
        skipDenoise,
        selectedReferences,
        sourceDatasetStats,
      } = body;
      if (!expName) return err(400, 'expName is required');
      if (!isSafePathSegment(expName)) {
        return err(400, 'expName may only contain letters, numbers, dots, dashes, and underscores');
      }

      return ok(await gpuPost('/train', {
        expName,
        ...(email !== undefined ? { email } : {}),
        config: {
          ...(batchSize !== undefined ? { batchSize } : {}),
          ...(sovitsEpochs !== undefined ? { sovitsEpochs } : {}),
          ...(gptEpochs !== undefined ? { gptEpochs } : {}),
          ...(sovitsSaveEvery !== undefined ? { sovitsSaveEvery } : {}),
          ...(gptSaveEvery !== undefined ? { gptSaveEvery } : {}),
          ...(asrLanguage !== undefined ? { asrLanguage } : {}),
          ...(asrModel !== undefined ? { asrModel } : {}),
          ...(skipDenoise !== undefined ? { skipDenoise } : {}),
          ...(selectedReferences && typeof selectedReferences === 'object' && !Array.isArray(selectedReferences)
            ? { selectedReferences }
            : {}),
          ...(sourceDatasetStats && typeof sourceDatasetStats === 'object' && !Array.isArray(sourceDatasetStats)
            ? { sourceDatasetStats }
            : {}),
        },
      }));
    }

    if (method === 'GET' && routePath.endsWith('/train/current')) {
      try {
        return ok(await gpuGet('/train/current'));
      } catch (error) {
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

    if (method === 'GET' && routePath.includes('/train/metadata/')) {
      const expName = decodeSegment(routePath.split('/train/metadata/')[1]?.replace(/\/$/u, ''));
      if (!expName || !isSafePathSegment(expName)) {
        return err(400, 'Invalid experiment name');
      }
      const raw = await readObject(`training/runs/${expName}/metadata.json`);
      if (!raw) {
        return err(404, `Training metadata not found for ${expName}`);
      }
      return ok({ expName, metadata: JSON.parse(raw.toString('utf-8')) });
    }

    return err(404, 'Not found');
  } catch (error) {
    return err(500, error.message);
  }
};
}

export const handler = createHandler();
