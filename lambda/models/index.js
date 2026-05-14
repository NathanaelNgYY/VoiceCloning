import path from 'path';
import { listObjects } from '../shared/s3.js';
import { inferencePost, inferenceGet } from '../shared/gpuWorker.js';
import { ok, err, preflight, parseJsonBody } from '../shared/cors.js';

function modelSource() {
  return (process.env.MODEL_SOURCE || 's3').trim().toLowerCase();
}

function useGpuWorkerModels() {
  return ['gpu-worker', 'gpu', 'local', 'gpt-sovits'].includes(modelSource());
}

function isWorkerUnavailableError(error) {
  const message = error?.message || '';
  return error instanceof TypeError
    || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|GPU_WORKER_URL env var|INFERENCE_WORKER_URL/u.test(message);
}

export function toModelSummary(object) {
  const lastModified = object.lastModified instanceof Date
    ? object.lastModified.toISOString()
    : object.lastModified || null;
  const mtimeMs = object.lastModified instanceof Date
    ? object.lastModified.getTime()
    : Date.parse(object.lastModified || '');

  return {
    name: path.basename(object.key),
    key: object.key,
    path: object.key,
    ...(typeof object.size === 'number' ? { size: object.size } : {}),
    ...(lastModified ? { lastModified } : {}),
    ...(Number.isFinite(mtimeMs) ? { mtimeMs } : {}),
  };
}

export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return preflight();
  }

  const method = event.requestContext?.http?.method;
  const routePath = event.rawPath || '';

  try {
    if (method === 'GET' && routePath.endsWith('/models')) {
      if (useGpuWorkerModels()) {
        try {
          return ok(await inferenceGet('/models'));
        } catch (error) {
          if (!isWorkerUnavailableError(error)) throw error;
          return ok({
            gpt: [],
            sovits: [],
            workerAvailable: false,
            message: error.message,
          });
        }
      }

      const [gptObjects, sovitsObjects] = await Promise.all([
        listObjects('models/user-models/gpt/'),
        listObjects('models/user-models/sovits/'),
      ]);
      const gpt = gptObjects
        .filter((object) => object.key.endsWith('.ckpt'))
        .map(toModelSummary);
      const sovits = sovitsObjects
        .filter((object) => object.key.endsWith('.pth'))
        .map(toModelSummary);
      return ok({ gpt, sovits });
    }

    if (method === 'POST' && routePath.endsWith('/models/select')) {
      let body;
      try {
        body = parseJsonBody(event);
      } catch {
        return err(400, 'Invalid JSON body');
      }

      const resolvedGptKey = body.gptKey || body.gptPath;
      const resolvedSovitsKey = body.sovitsKey || body.sovitsPath;

      let lastStatus = null;
      if (useGpuWorkerModels()) {
        if (resolvedSovitsKey) {
          lastStatus = await inferencePost('/inference/weights/sovits', { weightsPath: resolvedSovitsKey });
        }
        if (resolvedGptKey) {
          lastStatus = await inferencePost('/inference/weights/gpt', { weightsPath: resolvedGptKey });
        }
        return ok({
          message: 'Models loaded successfully',
          loaded: lastStatus?.loaded || {},
        });
      }

      if (resolvedSovitsKey) {
        const { localPath } = await inferencePost('/models/download', { s3Key: resolvedSovitsKey });
        lastStatus = await inferencePost('/inference/weights/sovits', { weightsPath: localPath });
      }
      if (resolvedGptKey) {
        const { localPath } = await inferencePost('/models/download', { s3Key: resolvedGptKey });
        lastStatus = await inferencePost('/inference/weights/gpt', { weightsPath: localPath });
      }

      return ok({
        message: 'Models loaded successfully',
        loaded: lastStatus?.loaded || {},
      });
    }

    return err(404, 'Not found');
  } catch (error) {
    return err(500, error.message);
  }
};
