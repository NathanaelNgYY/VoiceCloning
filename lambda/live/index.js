import { corsHeaders, err, preflight, parseJsonBody } from '../shared/cors.js';
import { gpuPostBinary } from '../shared/gpuWorker.js';

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

  if (!body.text?.trim()) {
    return err(400, 'text is required');
  }
  if (!body.ref_audio_path) {
    return err(400, 'ref_audio_path is required');
  }

  try {
    const { buffer, contentType } = await gpuPostBinary('/inference/tts', {
      ...body,
      text: `${body.text.trim()} `,
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
    return err(500, error.message);
  }
};
