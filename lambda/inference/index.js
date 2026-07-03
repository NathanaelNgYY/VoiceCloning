import { generatePresignedGetUrl } from '../shared/s3.js';
import { inferencePost, inferenceGet, inferencePostBinary, inferenceGetBinary, inferencePublicUrl } from '../shared/gpuWorker.js';
import { useGpuWorkerArtifacts } from '../shared/artifacts.js';
import { corsHeaders, ok, err, preflight, parseJsonBody } from '../shared/cors.js';
import { createVoiceProfileResolver, VoiceProfileResolutionError } from '../shared/voiceProfileRuntime.js';
import { demoHeaders } from '../shared/demoOrigin.js';

function isWorkerUnavailableError(error) {
  const message = error?.message || '';
  return error instanceof TypeError
    || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|GPU_WORKER_URL env var|INFERENCE_WORKER_URL/u.test(message);
}

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

function redirect(location) {
  return {
    statusCode: 302,
    headers: {
      ...corsHeaders,
      Location: location,
      'Cache-Control': 'no-store',
    },
    body: '',
  };
}

export function createHandler({
  resolveSynthesisBody = createVoiceProfileResolver(),
  postBinary = inferencePostBinary,
  getBinary = inferenceGetBinary,
  postJson = inferencePost,
  getJson = inferenceGet,
  isWorkerUnavailable = isWorkerUnavailableError,
  shouldUseGpuWorkerArtifacts = useGpuWorkerArtifacts,
  buildInferencePublicUrl = inferencePublicUrl,
  buildPresignedGetUrl = generatePresignedGetUrl,
} = {}) {
  return async function handler(event) {
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return preflight();
    }

    const method = event.requestContext?.http?.method;
    const routePath = event.rawPath || '';
    // Non-empty only for requests from the demo CloudFront (DEMO_CLOUDFRONT_HOST); tells
    // the worker to preempt any in-flight Live Full generation for this request.
    const demoHdr = demoHeaders(event);
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
        const resolvedBody = await resolveSynthesisBody(body);
        if (!resolvedBody.ref_audio_path) return err(400, 'ref_audio_path is required');
        const { buffer, contentType } = await postBinary('/inference', resolvedBody, demoHdr);
        return binaryWav(buffer, contentType);
      }

      if (method === 'POST' && routePath.endsWith('/inference/generate')) {
        if (!body.text) return err(400, 'text is required');
        const resolvedBody = await resolveSynthesisBody(body);
        if (!resolvedBody.ref_audio_path) return err(400, 'ref_audio_path is required');
        return ok(await postJson('/inference/generate', resolvedBody, demoHdr));
      }

      if (method === 'GET' && routePath.includes('/inference/result/')) {
        const sessionId = routePath.split('/inference/result/')[1]?.replace(/\/$/u, '');
        if (!sessionId || !/^[A-Za-z0-9-]+$/u.test(sessionId)) {
          return err(400, 'Invalid sessionId');
        }
        if (shouldUseGpuWorkerArtifacts()) {
          const url = buildInferencePublicUrl(`/inference/result/${encodeURIComponent(sessionId)}`);
          return event.queryStringParameters?.audio === '1' ? redirect(url) : ok({ url });
        }
        const url = await buildPresignedGetUrl(`audio/output/${sessionId}/final.wav`);
        return event.queryStringParameters?.audio === '1' ? redirect(url) : ok({ url });
      }

      if (method === 'GET' && routePath.includes('/inference/chunk/')) {
        const match = routePath.match(/\/inference\/chunk\/([A-Za-z0-9-]+)\/(\d+)\/?$/u);
        if (!match) return err(400, 'Invalid inference chunk path');
        const [, sessionId, index] = match;
        const { buffer, contentType } = await getBinary(
          `/inference/chunk/${encodeURIComponent(sessionId)}/${encodeURIComponent(index)}`,
        );
        return binaryWav(buffer, contentType);
      }

      if (method === 'POST' && routePath.endsWith('/inference/cancel')) {
        const { sessionId } = body;
        if (!sessionId) return err(400, 'sessionId is required');
        return ok(await postJson('/inference/cancel', { sessionId }));
      }

      if (method === 'POST' && routePath.endsWith('/inference/stop')) {
        return ok(await postJson('/inference/stop', {}));
      }

      if (method === 'POST' && routePath.endsWith('/inference/start')) {
        return ok(await postJson('/inference/start', {}));
      }

      if (method === 'GET' && routePath.endsWith('/inference/current')) {
        try {
          return ok(await getJson('/inference/current'));
        } catch (error) {
          return ok({
            sessionId: null,
            status: 'idle',
            workerAvailable: false,
            message: error.message,
          });
        }
      }

      if (method === 'GET' && routePath.endsWith('/inference/status')) {
        try {
          return ok(await getJson('/inference/status'));
        } catch (error) {
          return ok({
            ready: false,
            workerAvailable: !isWorkerUnavailable(error),
            error: error.message,
            managed: false,
          });
        }
      }

      return err(404, 'Not found');
    } catch (error) {
      if (error instanceof VoiceProfileResolutionError) {
        return err(error.statusCode, error.message);
      }
      return err(500, error.message);
    }
  };
}

export const handler = createHandler();
