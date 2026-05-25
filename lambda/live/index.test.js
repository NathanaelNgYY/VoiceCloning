import test from 'node:test';
import assert from 'node:assert/strict';

import { createHandler, handler } from './index.js';

test('live tts handler resolves voiceProfileId to a saved full profile before synthesis', async () => {
  const calls = [];
  const handler = createHandler({
    resolveSynthesisBody: async (body) => ({
      ...body,
      ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
      prompt_text: 'Reference transcript',
      prompt_lang: 'en',
      text_lang: 'en',
      aux_ref_audio_paths: ['training/datasets/lecturer-a/aux1.wav'],
      top_k: 6,
      top_p: 0.88,
      temperature: 0.69,
      repetition_penalty: 1.3,
      speed_factor: 1.0,
    }),
    postBinary: async (routePath, payload) => {
      calls.push({ routePath, payload });
      return {
        buffer: Buffer.from('RIFFdemo'),
        contentType: 'audio/wav',
      };
    },
  });

  const response = await handler({
    requestContext: { http: { method: 'POST' } },
    rawPath: '/api/live/tts-sentence',
    body: JSON.stringify({
      text: 'Hello there.',
      voiceProfileId: 'lecturer-a-v1',
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'audio/wav');
  assert.equal('X-Word-Timestamps' in response.headers, false);
  assert.equal(Buffer.from(response.body, 'base64').toString('utf-8'), 'RIFFdemo');
  assert.deepEqual(calls, [
    {
      routePath: '/inference/tts',
      payload: {
        text: 'Hello there. ',
        voiceProfileId: 'lecturer-a-v1',
        ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
        prompt_text: 'Reference transcript',
        prompt_lang: 'en',
        text_lang: 'en',
        aux_ref_audio_paths: ['training/datasets/lecturer-a/aux1.wav'],
        top_k: 6,
        top_p: 0.88,
        temperature: 0.69,
        repetition_penalty: 1.3,
        speed_factor: 1.0,
        text_split_method: 'cut0',
        batch_size: 1,
        streaming_mode: false,
        split_bucket: true,
        parallel_infer: false,
        fragment_interval: 0.1,
      },
    },
  ]);
});

test('live tts handler proxies synthesis through the inference worker URL', async () => {
  const previousFetch = globalThis.fetch;
  const previousInferenceWorkerUrl = process.env.INFERENCE_WORKER_URL;
  const previousGpuWorkerUrl = process.env.GPU_WORKER_URL;
  const calls = [];

  process.env.INFERENCE_WORKER_URL = 'http://inference-worker.local:3003';
  process.env.GPU_WORKER_URL = 'http://gpu-worker.local:3001';
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(Buffer.from('RIFFdemo'), {
      status: 200,
      headers: { 'Content-Type': 'audio/wav' },
    });
  };

  try {
    const response = await handler({
      requestContext: { http: { method: 'POST' } },
      rawPath: '/api/live/tts-sentence',
      body: JSON.stringify({
        text: 'Hello there.',
        ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Content-Type'], 'audio/wav');
    assert.equal('X-Word-Timestamps' in response.headers, false);
    assert.equal(calls[0].url, 'http://inference-worker.local:3003/inference/tts');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousInferenceWorkerUrl === undefined) {
      delete process.env.INFERENCE_WORKER_URL;
    } else {
      process.env.INFERENCE_WORKER_URL = previousInferenceWorkerUrl;
    }
    if (previousGpuWorkerUrl === undefined) {
      delete process.env.GPU_WORKER_URL;
    } else {
      process.env.GPU_WORKER_URL = previousGpuWorkerUrl;
    }
  }
});
