import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from './index.js';

test('training handler forwards start requests to the GPU worker with nested config', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  process.env.GPU_WORKER_URL = 'http://gpu-worker.local:3001';
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ sessionId: 'worker-session', steps: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const response = await handler({
      requestContext: { http: { method: 'POST' } },
      rawPath: '/api/train',
      body: JSON.stringify({
        expName: 'demo',
        batchSize: 2,
        sovitsEpochs: 4,
        gptEpochs: 3,
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { sessionId: 'worker-session', steps: [] });
    assert.equal(calls[0].url, 'http://gpu-worker.local:3001/train');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      expName: 'demo',
      config: {
        batchSize: 2,
        sovitsEpochs: 4,
        gptEpochs: 3,
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('training current returns idle when the GPU worker is not reachable', async () => {
  const previousFetch = globalThis.fetch;
  process.env.GPU_WORKER_URL = 'http://localhost:3999';
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  try {
    const response = await handler({
      requestContext: { http: { method: 'GET' } },
      rawPath: '/api/train/current',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      sessionId: null,
      status: 'idle',
      steps: [],
      logs: [],
      workerAvailable: false,
      message: 'fetch failed',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
