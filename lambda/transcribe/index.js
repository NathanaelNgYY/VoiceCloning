import { gpuPost } from '../shared/gpuWorker.js';
import { ok, err, preflight, parseJsonBody } from '../shared/cors.js';

export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return preflight();
  }

  let body;
  try {
    body = parseJsonBody(event);
  } catch {
    return err(400, 'Invalid JSON body');
  }

  const { filePath, language = 'auto' } = body;
  if (!filePath) {
    return err(400, 'filePath is required');
  }

  try {
    return ok(await gpuPost('/transcribe', { s3Key: filePath, language }));
  } catch (error) {
    return err(500, error.message);
  }
};
