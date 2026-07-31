import { corsHeaders, err, ok, preflight, parseJsonBody } from '../shared/cors.js';
import { inferencePost, inferencePostBinary } from '../shared/gpuWorker.js';
import { createVoiceProfileResolver, VoiceProfileResolutionError } from '../shared/voiceProfileRuntime.js';
import { demoHeaders } from '../shared/demoOrigin.js';

const REPLY_TOKEN_HEADER = 'X-VCS-Reply-Token';

// Header names arrive lower-cased on Function URL events, but casing is not
// guaranteed across invoke paths — match case-insensitively.
export function readReplyToken(event) {
  const headers = event?.headers || {};
  const key = Object.keys(headers)
    .find((name) => name.toLowerCase() === REPLY_TOKEN_HEADER.toLowerCase());
  return key ? String(headers[key] || '').trim() : '';
}

function isCancelPath(event) {
  const path = event?.rawPath || event?.requestContext?.http?.path || '';
  return /\/api\/live\/cancel\/?$/u.test(path);
}

export function createHandler({
  resolveSynthesisBody = createVoiceProfileResolver(),
  postBinary = inferencePostBinary,
  post = inferencePost,
} = {}) {
  return async function handler(event) {
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return preflight(event);
    }

    let body;
    try {
      body = parseJsonBody(event);
    } catch {
      return err(400, 'Invalid JSON body');
    }

    // Barge-in cancel. Deliberately does no voice-profile resolution: it must be
    // as cheap as possible, since it races the clip request it is cancelling.
    if (isCancelPath(event)) {
      const replyToken = String(body.replyToken || '').trim();
      if (!replyToken) {
        return err(400, 'replyToken is required', event);
      }
      try {
        return ok(await post('/live/cancel', { replyToken }), {}, event);
      } catch (error) {
        // A cancel that fails costs one wasted clip, never a broken conversation.
        return ok({ freed: 0, error: error.message }, {}, event);
      }
    }

    if (!body.text?.trim()) {
      return err(400, 'text is required');
    }

    const replyToken = readReplyToken(event);
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
      }, {
        ...demoHeaders(event),
        // Lets barge-in free this clip if it is still queued on the worker.
        ...(replyToken ? { [REPLY_TOKEN_HEADER]: replyToken } : {}),
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
      if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599) {
        return err(error.statusCode, error.message);
      }
      return err(500, error.message);
    }
  };
}

export const handler = createHandler();
