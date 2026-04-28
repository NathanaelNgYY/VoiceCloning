import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from './index.js';

test('inference handler proxies direct synthesis as base64 WAV', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
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
      rawPath: '/api/inference',
      body: JSON.stringify({
        text: 'Hello.',
        ref_audio_path: 'audio/reference/ref.wav',
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.isBase64Encoded, true);
    assert.equal(response.headers['Content-Type'], 'audio/wav');
    assert.equal(Buffer.from(response.body, 'base64').toString('utf-8'), 'RIFFdemo');
    assert.equal(calls[0].url, 'http://gpu-worker.local:3001/inference');
  } finally {
    globalThis.fetch = previousFetch;
  }
});
