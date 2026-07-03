import { ok, preflight } from '../shared/cors.js';

export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return preflight();
  }

  return ok({
    storageMode: 's3',
    inferenceMode: 'remote',
    // When the new full chatbot demo is live, flip the LIVE_DEMO_LOCKOUT env
    // var to 'true' on this Lambda. The legacy chatbot + training frontends
    // poll this flag and block all inference/training so the demo owns the
    // shared backend/GPU. The new full chatbot build does not read this flag.
    liveDemoLockout: process.env.LIVE_DEMO_LOCKOUT === 'true',
  });
};
