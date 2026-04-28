import path from 'path';
import { listObjects } from '../shared/s3.js';
import { gpuPost } from '../shared/gpuWorker.js';
import { ok, err, preflight, parseJsonBody } from '../shared/cors.js';

export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return preflight();
  }

  const method = event.requestContext?.http?.method;
  const routePath = event.rawPath || '';

  try {
    if (method === 'GET' && routePath.endsWith('/models')) {
      const [gptObjects, sovitsObjects] = await Promise.all([
        listObjects('models/user-models/gpt/'),
        listObjects('models/user-models/sovits/'),
      ]);
      const gpt = gptObjects
        .filter((object) => object.key.endsWith('.ckpt'))
        .map((object) => ({ name: path.basename(object.key), key: object.key, path: object.key }));
      const sovits = sovitsObjects
        .filter((object) => object.key.endsWith('.pth'))
        .map((object) => ({ name: path.basename(object.key), key: object.key, path: object.key }));
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
      if (resolvedSovitsKey) {
        const { localPath } = await gpuPost('/models/download', { s3Key: resolvedSovitsKey });
        lastStatus = await gpuPost('/inference/weights/sovits', { weightsPath: localPath });
      }
      if (resolvedGptKey) {
        const { localPath } = await gpuPost('/models/download', { s3Key: resolvedGptKey });
        lastStatus = await gpuPost('/inference/weights/gpt', { weightsPath: localPath });
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
