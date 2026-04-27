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

test('training audio list can proxy to GPU worker artifacts instead of S3', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({
      expName: 'leehsienglong',
      files: [{
        filename: 'sample.wav',
        path: 'C:/gpt/data/leehsienglong/denoised/sample.wav',
        transcript: 'hello',
        lang: 'en',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await withEnv({
      ARTIFACT_SOURCE: 'gpu-worker',
      GPU_WORKER_URL: 'http://localhost:3001',
      GPU_WORKER_PUBLIC_URL: 'https://gpu-worker.example.com',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'GET' } },
        rawPath: '/api/training-audio/leehsienglong',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(calls[0], 'http://localhost:3001/training-audio/leehsienglong');
      assert.equal(JSON.parse(response.body).files[0].transcript, 'hello');
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('training audio file can return a GPU worker public URL instead of S3', async () => {
  await withEnv({
    ARTIFACT_SOURCE: 'gpu-worker',
    GPU_WORKER_URL: 'http://localhost:3001',
    GPU_WORKER_PUBLIC_URL: 'https://gpu-worker.example.com',
  }, async () => {
    const response = await handler({
      requestContext: { http: { method: 'GET' } },
      rawPath: '/api/training-audio/file/leehsienglong/sample.wav',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      url: 'https://gpu-worker.example.com/training-audio/file/leehsienglong/sample.wav',
    });
  });
});
