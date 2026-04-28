import { generatePresignedGetUrl } from '../shared/s3.js';
import { gpuPost, gpuGet, gpuPostBinary } from '../shared/gpuWorker.js';
import { corsHeaders, ok, err, preflight, parseJsonBody } from '../shared/cors.js';

function binaryWav(buffer, contentType = 'audio/wav') {
  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      ...corsHeaders,
    },
    body: buffer.toString('base64'),
  };
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
    if (method === 'POST' && routePath.endsWith('/inference')) {
      if (!body.text) return err(400, 'text is required');
      if (!body.ref_audio_path) return err(400, 'ref_audio_path is required');
      const { buffer, contentType } = await gpuPostBinary('/inference', body);
      return binaryWav(buffer, contentType);
    }

    if (method === 'POST' && routePath.endsWith('/inference/generate')) {
      if (!body.text) return err(400, 'text is required');
      if (!body.ref_audio_path) return err(400, 'ref_audio_path is required');
      return ok(await gpuPost('/inference/generate', body));
    }

    if (method === 'GET' && routePath.includes('/inference/result/')) {
      const sessionId = routePath.split('/inference/result/')[1]?.replace(/\/$/u, '');
      if (!sessionId || !/^[A-Za-z0-9-]+$/u.test(sessionId)) {
        return err(400, 'Invalid sessionId');
      }
      const url = await generatePresignedGetUrl(`audio/output/${sessionId}/final.wav`);
      return ok({ url });
    }

    if (method === 'POST' && routePath.endsWith('/inference/cancel')) {
      const { sessionId } = body;
      if (!sessionId) return err(400, 'sessionId is required');
      return ok(await gpuPost('/inference/cancel', { sessionId }));
    }

    if (method === 'POST' && routePath.endsWith('/inference/stop')) {
      return ok(await gpuPost('/inference/stop', {}));
    }

    if (method === 'GET' && routePath.endsWith('/inference/current')) {
      return ok(await gpuGet('/inference/current'));
    }

    if (method === 'GET' && routePath.endsWith('/inference/status')) {
      return ok(await gpuGet('/inference/status'));
    }

    return err(404, 'Not found');
  } catch (error) {
    return err(500, error.message);
  }
};
