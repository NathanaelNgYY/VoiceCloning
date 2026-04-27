import { ok, preflight } from '../shared/cors.js';

export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return preflight();
  }

  return ok({
    storageMode: 's3',
    inferenceMode: 'remote',
  });
};
