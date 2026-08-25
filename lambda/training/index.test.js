import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, handler } from './index.js';

// Every run creates a new voice, so what the handler does depends on which
// voices already exist. A stub keeps that explicit per test.
function handlerWithVoices(takenNames = []) {
  return createHandler({ listTrainedVoiceNames: async () => takenNames });
}

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
    const response = await handlerWithVoices()({
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
    await handlerWithVoices()({
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
      const response = await handlerWithVoices()({
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
    await handlerWithVoices()({
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

test('train/next-name allocates the base name first, then the next free number', async () => {
  const first = await handlerWithVoices([])({
    requestContext: { http: { method: 'POST' } },
    rawPath: '/api/train/next-name',
    body: JSON.stringify({ email: 'josephsung@ntu.edu.sg' }),
  });
  assert.equal(first.statusCode, 200);
  assert.equal(JSON.parse(first.body).expName, 'DeanVoice');

  const second = await handlerWithVoices(['DeanVoice', 'Obama'])({
    requestContext: { http: { method: 'POST' } },
    rawPath: '/api/train/next-name',
    body: JSON.stringify({ email: 'josephsung@ntu.edu.sg' }),
  });
  const allocated = JSON.parse(second.body);
  assert.equal(allocated.expName, 'DeanVoice_2');
  assert.equal(allocated.baseVoiceName, 'DeanVoice');
  assert.deepEqual(allocated.existingVoiceNames, ['DeanVoice'], 'another lecturer\'s voice is not listed');
});

test('train/next-name refuses a non-NTU address', async () => {
  const response = await handlerWithVoices([])({
    requestContext: { http: { method: 'POST' } },
    rawPath: '/api/train/next-name',
    body: JSON.stringify({ email: 'someone@gmail.com' }),
  });
  assert.equal(response.statusCode, 400);
});

test('training never replaces a voice: an existing name is refused, not obeyed', async () => {
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
    const response = await handlerWithVoices(['DeanVoice'])({
      requestContext: { http: { method: 'POST' } },
      rawPath: '/api/train',
      body: JSON.stringify({ email: 'josephsung@ntu.edu.sg', expName: 'DeanVoice' }),
    });

    assert.equal(response.statusCode, 409);
    assert.match(JSON.parse(response.body).error, /already exists/u);
    assert.equal(calls.length, 0, 'no run may reach the worker under an existing name');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('training refuses a name the lecturer does not own, whatever the client proposes', async () => {
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
    for (const expName of ['DeanVoice', 'alice-tan', 'alice2', 'alice_1']) {
      const response = await handlerWithVoices([])({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/train',
        body: JSON.stringify({ email: 'alice@ntu.edu.sg', expName }),
      });
      assert.equal(response.statusCode, 403, `${expName} should not be trainable by alice@`);
    }
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a client that proposes no name still gets the next free one', async () => {
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
    await handlerWithVoices(['DeanVoice', 'DeanVoice_2'])({
      requestContext: { http: { method: 'POST' } },
      rawPath: '/api/train',
      body: JSON.stringify({ email: 'josephsung@ntu.edu.sg' }),
    });
    assert.equal(JSON.parse(calls[0].options.body).expName, 'DeanVoice_3');
  } finally {
    globalThis.fetch = previousFetch;
  }
});
