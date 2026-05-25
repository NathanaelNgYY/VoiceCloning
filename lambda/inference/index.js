import { generatePresignedGetUrl } from '../shared/s3.js';
import { inferencePost, inferenceGet, inferencePostBinary, inferencePublicUrl } from '../shared/gpuWorker.js';
import { useGpuWorkerArtifacts } from '../shared/artifacts.js';
import { corsHeaders, ok, err, preflight, parseJsonBody } from '../shared/cors.js';
import { createVoiceProfileResolver, VoiceProfileResolutionError } from '../shared/voiceProfileRuntime.js';

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

export function createHandler({
  resolveSynthesisBody = createVoiceProfileResolver(),
  postBinary = inferencePostBinary,
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
        const { buffer, contentType } = await postBinary('/inference', resolvedBody);
        return binaryWav(buffer, contentType);
      }

      if (method === 'POST' && routePath.endsWith('/inference/generate')) {
        if (!body.text) return err(400, 'text is required');
        const resolvedBody = await resolveSynthesisBody(body);
        if (!resolvedBody.ref_audio_path) return err(400, 'ref_audio_path is required');
        return ok(await postJson('/inference/generate', resolvedBody));
      }

      if (method === 'GET' && routePath.includes('/inference/result/')) {
        const sessionId = routePath.split('/inference/result/')[1]?.replace(/\/$/u, '');
        if (!sessionId || !/^[A-Za-z0-9-]+$/u.test(sessionId)) {
          return err(400, 'Invalid sessionId');
        }
        if (shouldUseGpuWorkerArtifacts()) {
          return ok({ url: buildInferencePublicUrl(`/inference/result/${encodeURIComponent(sessionId)}`) });
        }
        const url = await buildPresignedGetUrl(`audio/output/${sessionId}/final.wav`);
        return ok({ url });
      }

      if (method === 'POST' && routePath.endsWith('/inference/cancel')) {
        const { sessionId } = body;
        if (!sessionId) return err(400, 'sessionId is required');
        return ok(await postJson('/inference/cancel', { sessionId }));
      }

      if (method === 'POST' && routePath.endsWith('/inference/stop')) {
        return ok(await postJson('/inference/stop', {}));
      }

      if (method === 'GET' && routePath.endsWith('/inference/current')) {
        try {
          return ok(await getJson('/inference/current'));
        } catch (error) {
          if (!isWorkerUnavailable(error)) throw error;
          return ok({
            sessionId: null,
            status: 'idle',
            workerAvailable: false,
            message: error.message,
          });
        }
      }

      if (method === 'GET' && routePath.endsWith('/inference/status')) {
        return ok(await getJson('/inference/status'));
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
