import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, handler } from './index.js';

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
    assert.equal('X-Word-Timestamps' in response.headers, false);
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

test('inference result audio request redirects to the playable artifact URL', async () => {
  await withEnv({
    ARTIFACT_SOURCE: 'gpu-worker',
    GPU_WORKER_URL: 'http://gpu-worker.internal:3001',
    GPU_WORKER_PUBLIC_URL: 'https://gpu-worker.example.com',
  }, async () => {
    const response = await handler({
      requestContext: { http: { method: 'GET' } },
      rawPath: '/api/inference/result/abc-123',
      queryStringParameters: { audio: '1' },
    });

    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.Location, 'https://gpu-worker.example.com/inference/result/abc-123');
    assert.equal(response.headers['Cache-Control'], 'no-store');
  });
});

test('inference chunk proxies chunk audio from the GPU worker', async () => {
  const calls = [];
  const localHandler = createHandler({
    postBinary: async (routePath, payload) => {
      calls.push({ type: 'postBinary', routePath, payload });
      throw new Error('unexpected post');
    },
    getJson: async () => {
      throw new Error('unexpected json');
    },
    buildInferencePublicUrl: () => '',
    resolveSynthesisBody: async (body) => body,
    shouldUseGpuWorkerArtifacts: () => false,
    postJson: async () => ({}),
    isWorkerUnavailable: () => false,
    buildPresignedGetUrl: async () => '',
    getBinary: async (routePath) => {
      calls.push({ type: 'getBinary', routePath });
      return {
        buffer: Buffer.from('RIFFchunk'),
        contentType: 'audio/wav',
      };
    },
  });

  const response = await localHandler({
    requestContext: { http: { method: 'GET' } },
    rawPath: '/api/inference/chunk/abc-123/2',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.isBase64Encoded, true);
  assert.equal(Buffer.from(response.body, 'base64').toString('utf-8'), 'RIFFchunk');
  assert.deepEqual(calls, [{ type: 'getBinary', routePath: '/inference/chunk/abc-123/2' }]);
});

test('inference normalized chunk preview proxies preview audio', async () => {
  const calls = [];
  const localHandler = createHandler({
    resolveSynthesisBody: async (body) => body,
    shouldUseGpuWorkerArtifacts: () => false,
    postJson: async () => ({}),
    getJson: async () => ({}),
    postBinary: async () => { throw new Error('unexpected post'); },
    buildInferencePublicUrl: () => '',
    buildPresignedGetUrl: async () => '',
    isWorkerUnavailable: () => false,
    getBinary: async (routePath) => {
      calls.push(routePath);
      return { buffer: Buffer.from('RIFFpreview'), contentType: 'audio/wav' };
    },
  });
  const response = await localHandler({
    requestContext: { http: { method: 'GET' } },
    rawPath: '/api/inference/chunk-preview/abc-123/2',
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, ['/inference/chunk-preview/abc-123/2']);
});

test('inference targeted regeneration forwards edited sentence text', async () => {
  const calls = [];
  const localHandler = createHandler({
    resolveSynthesisBody: async (body) => body,
    shouldUseGpuWorkerArtifacts: () => false,
    postJson: async (routePath, payload) => {
      calls.push({ routePath, payload });
      return { revision: 42 };
    },
    getJson: async () => ({}),
    postBinary: async () => { throw new Error('unexpected post'); },
    getBinary: async () => { throw new Error('unexpected get'); },
    buildInferencePublicUrl: () => '',
    buildPresignedGetUrl: async () => '',
    isWorkerUnavailable: () => false,
  });
  const response = await localHandler({
    requestContext: { http: { method: 'POST' } },
    rawPath: '/api/inference/regenerate-chunk',
    body: JSON.stringify({ sessionId: 'abc-123', index: 2, text: 'Edited sentence text.' }),
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [{
    routePath: '/inference/regenerate-chunk',
    payload: { sessionId: 'abc-123', index: 2, text: 'Edited sentence text.' },
  }]);
});

test('inference preserves worker busy status for multi-user feedback', async () => {
  const localHandler = createHandler({
    resolveSynthesisBody: async (body) => ({ ...body, ref_audio_path: 'ref.wav' }),
    postJson: async () => {
      const error = new Error('Another generation is already running on this instance');
      error.statusCode = 409;
      throw error;
    },
  });

  const response = await localHandler({
    requestContext: { http: { method: 'POST' } },
    rawPath: '/api/inference/generate',
    body: JSON.stringify({ text: 'Hello.', voiceProfileId: 'voice-1' }),
  });

  assert.equal(response.statusCode, 409);
  assert.match(JSON.parse(response.body).error, /another generation/iu);
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

test('inference start proxies to the GPU worker start route', async () => {
  const calls = [];
  const localHandler = createHandler({
    postJson: async (routePath, payload) => {
      calls.push({ routePath, payload });
      return { ready: true };
    },
  });

  const response = await localHandler({
    requestContext: { http: { method: 'POST' } },
    rawPath: '/api/inference/start',
    body: '{}',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ready: true });
  assert.deepEqual(calls, [{ routePath: '/inference/start', payload: {} }]);
});

test('inference handler resolves voiceProfileId to a saved full profile before direct synthesis', async () => {
  const calls = [];
  const handler = createHandler({
    resolveSynthesisBody: async (body) => ({
      ...body,
      ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
      prompt_text: 'Reference transcript',
      prompt_lang: 'en',
      text_lang: 'en',
      aux_ref_audio_paths: ['training/datasets/lecturer-a/aux1.wav'],
      top_k: 5,
      top_p: 0.85,
      temperature: 0.7,
      repetition_penalty: 1.35,
      speed_factor: 1.0,
    }),
    postBinary: async (routePath, payload) => {
      calls.push({ routePath, payload });
      return {
        buffer: Buffer.from('RIFFvoice'),
        contentType: 'audio/wav',
      };
    },
  });

  const response = await handler({
    requestContext: { http: { method: 'POST' } },
    rawPath: '/api/inference',
    body: JSON.stringify({
      text: 'This should use the saved profile.',
      voiceProfileId: 'lecturer-a-v1',
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(Buffer.from(response.body, 'base64').toString('utf-8'), 'RIFFvoice');
  assert.deepEqual(calls, [
    {
      routePath: '/inference',
      payload: {
        text: 'This should use the saved profile.',
        voiceProfileId: 'lecturer-a-v1',
        ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
        prompt_text: 'Reference transcript',
        prompt_lang: 'en',
        text_lang: 'en',
        aux_ref_audio_paths: ['training/datasets/lecturer-a/aux1.wav'],
        top_k: 5,
        top_p: 0.85,
        temperature: 0.7,
        repetition_penalty: 1.35,
        speed_factor: 1.0,
      },
    },
  ]);
});
