import { corsHeaders, err, preflight, parseJsonBody } from '../shared/cors.js';
import { inferencePostBinary } from '../shared/gpuWorker.js';
import { createVoiceProfileResolver, VoiceProfileResolutionError } from '../shared/voiceProfileRuntime.js';

export function createHandler({
  resolveSynthesisBody = createVoiceProfileResolver(),
  postBinary = inferencePostBinary,
} = {}) {
  return async function handler(event) {
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return preflight();
    }

    let body;
    try {
      body = parseJsonBody(event);
    } catch {
      return err(400, 'Invalid JSON body');
    }

    if (!body.text?.trim()) {
      return err(400, 'text is required');
    }

    try {
      const resolvedBody = await resolveSynthesisBody(body);
      if (!resolvedBody.ref_audio_path) {
        return err(400, 'ref_audio_path is required');
      }

      const { buffer, contentType } = await postBinary('/inference/tts', {
        ...resolvedBody,
        text: `${resolvedBody.text.trim()} `,
        text_split_method: 'cut0',
        batch_size: 1,
        streaming_mode: false,
        split_bucket: true,
        parallel_infer: false,
        fragment_interval: 0.1,
      });

      return {
        statusCode: 200,
        isBase64Encoded: true,
        headers: {
          'Content-Type': contentType || 'audio/wav',
          'Content-Length': String(buffer.length),
          ...corsHeaders,
        },
        body: buffer.toString('base64'),
      };
    } catch (error) {
      if (error instanceof VoiceProfileResolutionError) {
        return err(error.statusCode, error.message);
      }
      return err(500, error.message);
    }
  };
}

export const handler = createHandler();
