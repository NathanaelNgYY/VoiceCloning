import test from 'node:test';
import assert from 'node:assert/strict';
import { toModelSummary } from './index.js';

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

test('toModelSummary includes object modification metadata for frontend recency sorting', () => {
  const lastModified = new Date('2026-05-08T03:14:00.000Z');

  assert.deepEqual(toModelSummary({
    key: 'models/user-models/gpt/latestVoice-e10.ckpt',
    size: 2048,
    lastModified,
  }), {
    name: 'latestVoice-e10.ckpt',
    key: 'models/user-models/gpt/latestVoice-e10.ckpt',
    path: 'models/user-models/gpt/latestVoice-e10.ckpt',
    size: 2048,
    lastModified: lastModified.toISOString(),
    mtimeMs: lastModified.getTime(),
  });
});

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

test('models select warms reference audio after local GPU model load when refs are provided', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, body });
    return new Response(JSON.stringify({
      loaded: { gptPath: body?.weightsPath || '' },
      ref_audio_path: body?.ref_audio_path || '',
      aux_ref_audio_paths: body?.aux_ref_audio_paths || [],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const { handler } = await import(`./index.js?gpu-select-warm=${Date.now()}`);
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
          ref_audio_path: 'refs/primary.wav',
          aux_ref_audio_paths: ['refs/aux-1.wav', 'refs/aux-2.wav'],
        }),
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, [
        {
          url: 'http://localhost:3001/inference/weights/sovits',
          body: { weightsPath: 'C:/sovits/local.pth' },
        },
        {
          url: 'http://localhost:3001/inference/weights/gpt',
          body: { weightsPath: 'C:/gpt/local.ckpt' },
        },
        {
          url: 'http://localhost:3001/ref-audio/warm',
          body: {
            ref_audio_path: 'refs/primary.wav',
            aux_ref_audio_paths: ['refs/aux-1.wav', 'refs/aux-2.wav'],
          },
        },
      ]);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('models select auto-selects and warms references from training audio when refs are omitted', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, body });

    if (String(url).endsWith('/training-audio/LhlChinese')) {
      return new Response(JSON.stringify({
        expName: 'LhlChinese',
        files: [
          {
            filename: 'intro.wav',
            path: 'training/datasets/LhlChinese/denoised/intro.wav',
            transcript: 'Hi',
            lang: 'zh',
          },
          {
            filename: 'LhlChinese_reference_0_192000.wav',
            path: 'training/datasets/LhlChinese/denoised/LhlChinese_reference_0_192000.wav',
            transcript: 'Today we are reviewing the quarterly planning update together.',
            lang: 'zh',
            qualityScore: 80,
          },
          {
            filename: 'support_0_160000.wav',
            path: 'training/datasets/LhlChinese/denoised/support_0_160000.wav',
            transcript: 'The next section explains how the roadmap changes affect the launch timeline.',
            lang: 'zh',
            qualityScore: 60,
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      loaded: { gptPath: body?.weightsPath || '' },
      ref_audio_path: body?.ref_audio_path || '',
      aux_ref_audio_paths: body?.aux_ref_audio_paths || [],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const { handler } = await import(`./index.js?gpu-select-auto-warm=${Date.now()}`);
    await withEnv({
      MODEL_SOURCE: 'gpu-worker',
      ARTIFACT_SOURCE: 'gpu-worker',
      GPU_WORKER_URL: 'http://localhost:3001',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/models/select',
        body: JSON.stringify({
          gptKey: 'C:/gpt/LhlChinese-e25.ckpt',
          sovitsKey: 'C:/sovits/LhlChinese_e20_s3060.pth',
        }),
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, [
        {
          url: 'http://localhost:3001/inference/weights/sovits',
          body: { weightsPath: 'C:/sovits/LhlChinese_e20_s3060.pth' },
        },
        {
          url: 'http://localhost:3001/inference/weights/gpt',
          body: { weightsPath: 'C:/gpt/LhlChinese-e25.ckpt' },
        },
        {
          url: 'http://localhost:3001/training-audio/LhlChinese',
          body: null,
        },
        {
          url: 'http://localhost:3001/ref-audio/warm',
          body: {
            ref_audio_path: 'training/datasets/LhlChinese/denoised/LhlChinese_reference_0_192000.wav',
            aux_ref_audio_paths: [
              'training/datasets/LhlChinese/denoised/support_0_160000.wav',
            ],
          },
        },
      ]);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('models select downloads S3 model keys when MODEL_SOURCE is s3', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, body });

    if (String(url).endsWith('/models/download')) {
      const filename = body.s3Key.replace(/\\/g, '/').split('/').pop();
      return new Response(JSON.stringify({
        localPath: `/tmp/model_cache/${filename}`,
        filename,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      loaded: { weightsPath: body.weightsPath },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const { handler } = await import(`./index.js?s3-select=${Date.now()}`);
    await withEnv({
      MODEL_SOURCE: 's3',
      GPU_WORKER_URL: 'http://localhost:3001',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/models/select',
        body: JSON.stringify({
          gptKey: 'models/user-models/gpt/trump.ckpt',
          sovitsKey: 'models/user-models/sovits/trump.pth',
        }),
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, [
        {
          url: 'http://localhost:3001/models/download',
          body: { s3Key: 'models/user-models/sovits/trump.pth' },
        },
        {
          url: 'http://localhost:3001/inference/weights/sovits',
          body: { weightsPath: '/tmp/model_cache/trump.pth' },
        },
        {
          url: 'http://localhost:3001/models/download',
          body: { s3Key: 'models/user-models/gpt/trump.ckpt' },
        },
        {
          url: 'http://localhost:3001/inference/weights/gpt',
          body: { weightsPath: '/tmp/model_cache/trump.ckpt' },
        },
      ]);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('models select warms reference audio after S3 model load when refs are provided', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, body });

    if (String(url).endsWith('/models/download')) {
      const filename = body.s3Key.replace(/\\/g, '/').split('/').pop();
      return new Response(JSON.stringify({
        localPath: `/tmp/model_cache/${filename}`,
        filename,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      loaded: { weightsPath: body?.weightsPath || '' },
      ref_audio_path: body?.ref_audio_path || '',
      aux_ref_audio_paths: body?.aux_ref_audio_paths || [],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const { handler } = await import(`./index.js?s3-select-warm=${Date.now()}`);
    await withEnv({
      MODEL_SOURCE: 's3',
      GPU_WORKER_URL: 'http://localhost:3001',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/models/select',
        body: JSON.stringify({
          gptKey: 'models/user-models/gpt/trump.ckpt',
          sovitsKey: 'models/user-models/sovits/trump.pth',
          ref_audio_path: 'training/runs/demo/denoised/ref.wav',
          aux_ref_audio_paths: ['training/runs/demo/denoised/aux-1.wav'],
        }),
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, [
        {
          url: 'http://localhost:3001/models/download',
          body: { s3Key: 'models/user-models/sovits/trump.pth' },
        },
        {
          url: 'http://localhost:3001/inference/weights/sovits',
          body: { weightsPath: '/tmp/model_cache/trump.pth' },
        },
        {
          url: 'http://localhost:3001/models/download',
          body: { s3Key: 'models/user-models/gpt/trump.ckpt' },
        },
        {
          url: 'http://localhost:3001/inference/weights/gpt',
          body: { weightsPath: '/tmp/model_cache/trump.ckpt' },
        },
        {
          url: 'http://localhost:3001/ref-audio/warm',
          body: {
            ref_audio_path: 'training/runs/demo/denoised/ref.wav',
            aux_ref_audio_paths: ['training/runs/demo/denoised/aux-1.wav'],
          },
        },
      ]);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
