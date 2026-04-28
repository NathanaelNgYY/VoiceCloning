import test from 'node:test';
import assert from 'node:assert/strict';

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    process.env[key] = values[key];
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(values)) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
    });
}

test('models handler can list models from GPU worker instead of S3', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({
      gpt: [{ name: 'local.ckpt', path: 'C:/gpt/local.ckpt', source: 'gpu-worker' }],
      sovits: [{ name: 'local.pth', path: 'C:/sovits/local.pth', source: 'gpu-worker' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const { handler } = await import(`./index.js?gpu-list=${Date.now()}`);
    await withEnv({
      MODEL_SOURCE: 'gpu-worker',
      GPU_WORKER_URL: 'http://localhost:3001',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'GET' } },
        rawPath: '/api/models',
      });

      assert.equal(response.statusCode, 200);
      assert.equal(calls[0], 'http://localhost:3001/models');
      assert.deepEqual(JSON.parse(response.body).gpt[0], {
        name: 'local.ckpt',
        path: 'C:/gpt/local.ckpt',
        source: 'gpu-worker',
      });
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('models handler returns an empty library when GPU worker models are unreachable', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  try {
    const { handler } = await import(`./index.js?gpu-list-unavailable=${Date.now()}`);
    await withEnv({
      MODEL_SOURCE: 'gpu-worker',
      GPU_WORKER_URL: 'http://localhost:3001',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'GET' } },
        rawPath: '/api/models',
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(response.body), {
        gpt: [],
        sovits: [],
        workerAvailable: false,
        message: 'fetch failed',
      });
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('models select uses local GPU paths when MODEL_SOURCE is gpu-worker', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
    return new Response(JSON.stringify({
      loaded: { gptPath: calls.at(-1).body.weightsPath },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const { handler } = await import(`./index.js?gpu-select=${Date.now()}`);
    await withEnv({
      MODEL_SOURCE: 'gpu-worker',
      GPU_WORKER_URL: 'http://localhost:3001',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/models/select',
        body: JSON.stringify({
          gptKey: 'C:/gpt/local.ckpt',
          sovitsKey: 'C:/sovits/local.pth',
        }),
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls.map((call) => call.url), [
        'http://localhost:3001/inference/weights/sovits',
        'http://localhost:3001/inference/weights/gpt',
      ]);
      assert.deepEqual(calls.map((call) => call.body), [
        { weightsPath: 'C:/sovits/local.pth' },
        { weightsPath: 'C:/gpt/local.ckpt' },
      ]);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
