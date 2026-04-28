import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from './index.js';

async function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    process.env[key] = values[key];
  }

  try {
    return await fn();
  } finally {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

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

test('inference result can return a GPU worker artifact URL instead of S3', async () => {
  await withEnv({
    ARTIFACT_SOURCE: 'gpu-worker',
    GPU_WORKER_URL: 'http://gpu-worker.internal:3001',
    GPU_WORKER_PUBLIC_URL: 'https://gpu-worker.example.com',
  }, async () => {
    const response = await handler({
      requestContext: { http: { method: 'GET' } },
      rawPath: '/api/inference/result/abc-123',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      url: 'https://gpu-worker.example.com/inference/result/abc-123',
    });
  });
});

test('inference current returns idle when the GPU worker is not reachable', async () => {
  const previousFetch = globalThis.fetch;
  process.env.GPU_WORKER_URL = 'http://localhost:3999';
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  try {
    const response = await handler({
      requestContext: { http: { method: 'GET' } },
      rawPath: '/api/inference/current',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      sessionId: null,
      status: 'idle',
      workerAvailable: false,
      message: 'fetch failed',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
