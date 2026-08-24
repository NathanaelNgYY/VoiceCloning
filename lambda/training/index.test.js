import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, handler } from './index.js';

test('training handler names the run after the NTU email and forwards nested config', async () => {
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
        email: 'Alice.Tan@staff.main.ntu.edu.sg',
        batchSize: 2,
        sovitsEpochs: 4,
        gptEpochs: 3,
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { sessionId: 'worker-session', steps: [] });
    assert.equal(calls[0].url, 'http://gpu-worker.local:3001/train');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      expName: 'alice-tan',
      email: 'alice.tan@staff.main.ntu.edu.sg',
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

test('training handler forwards training metadata inputs to the GPU worker config', async () => {
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
    await handler({
      requestContext: { http: { method: 'POST' } },
      rawPath: '/api/train',
      body: JSON.stringify({
        email: 'demo@ntu.edu.sg',
        skipDenoise: true,
        selectedReferences: {
          mode: 'strict',
          primary: { path: 'training/datasets/demo/denoised/ref.wav', score: 124 },
        },
        sourceDatasetStats: {
          rawFileCount: 3,
          candidateClipCount: 12,
        },
      }),
    });

    assert.deepEqual(JSON.parse(calls[0].options.body).config, {
      skipDenoise: true,
      selectedReferences: {
        mode: 'strict',
        primary: { path: 'training/datasets/demo/denoised/ref.wav', score: 124 },
      },
      sourceDatasetStats: {
        rawFileCount: 3,
        candidateClipCount: 12,
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('training handler refuses to start a run without a usable NTU email', async () => {
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
    for (const body of [{}, { email: 'user@test.com' }, { email: 'nope' }]) {
      const response = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/train',
        body: JSON.stringify(body),
      });
      assert.equal(response.statusCode, 400, `should reject ${JSON.stringify(body)}`);
    }

    assert.equal(calls.length, 0, 'no run may reach the GPU worker without an NTU email');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('training handler ignores a client-supplied expName and uses the email-derived one', async () => {
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
    await handler({
      requestContext: { http: { method: 'POST' } },
      rawPath: '/api/train',
      body: JSON.stringify({ expName: 'DeanVoice', email: 'alice.tan@ntu.edu.sg' }),
    });

    assert.equal(JSON.parse(calls[0].options.body).expName, 'alice-tan');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('training handler routes the dean to his already-deployed DeanVoice run', async () => {
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
    await handler({
      requestContext: { http: { method: 'POST' } },
      rawPath: '/api/train',
      body: JSON.stringify({ email: 'josephsung@ntu.edu.sg' }),
    });

    assert.equal(JSON.parse(calls[0].options.body).expName, 'DeanVoice');
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

test('training metadata returns stored run metadata for an experiment', async () => {
  const handlerWithMetadata = createHandler({
    readObject: async (key) => {
      assert.equal(key, 'training/runs/demo/metadata.json');
      return Buffer.from(JSON.stringify({
        engineVersion: 'v2ProPlus',
        training: {
          batchSize: 2,
          sovitsEpochs: 8,
          gptEpochs: 15,
          skipDenoise: true,
        },
        sourceDatasetStats: {
          rawFileCount: 3,
        },
      }), 'utf-8');
    },
  });

  const response = await handlerWithMetadata({
    requestContext: { http: { method: 'GET' } },
    rawPath: '/api/train/metadata/demo',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    expName: 'demo',
    metadata: {
      engineVersion: 'v2ProPlus',
      training: {
        batchSize: 2,
        sovitsEpochs: 8,
        gptEpochs: 15,
        skipDenoise: true,
      },
      sourceDatasetStats: {
        rawFileCount: 3,
      },
    },
  });
});

test('training metadata returns 404 when no run metadata exists', async () => {
  const handlerWithMetadata = createHandler({
    readObject: async () => null,
  });

  const response = await handlerWithMetadata({
    requestContext: { http: { method: 'GET' } },
    rawPath: '/api/train/metadata/demo',
  });

  assert.equal(response.statusCode, 404);
  assert.match(JSON.parse(response.body).error, /metadata not found/u);
});

test('training handler suffixes the run with the requested label so one lecturer keeps several voices', async () => {
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
    await handler({
      requestContext: { http: { method: 'POST' } },
      rawPath: '/api/train',
      body: JSON.stringify({ email: 'josephsung@ntu.edu.sg', label: '2' }),
    });
    assert.equal(JSON.parse(calls[0].options.body).expName, 'DeanVoice_2');

    const rejected = await handler({
      requestContext: { http: { method: 'POST' } },
      rawPath: '/api/train',
      body: JSON.stringify({ email: 'josephsung@ntu.edu.sg', label: '///' }),
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a label cannot be used to escape into another lecturer’s voice', async () => {
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
    await handler({
      requestContext: { http: { method: 'POST' } },
      rawPath: '/api/train',
      body: JSON.stringify({ email: 'alice@ntu.edu.sg', label: 'tan' }),
    });

    // alice-tan belongs to alice.tan@ntu.edu.sg; alice@ can only reach alice_tan.
    assert.equal(JSON.parse(calls[0].options.body).expName, 'alice_tan');
  } finally {
    globalThis.fetch = previousFetch;
  }
});
