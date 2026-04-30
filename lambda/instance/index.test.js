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

test('instance status reports unconfigured local-safe mode without an EC2 id', async () => {
  const { handler } = await import(`./index.js?unconfigured=${Date.now()}`);

  await withEnv({ GPU_INSTANCE_ID: '', GPU_WORKER_URL: 'http://localhost:3001' }, async () => {
    const response = await handler({
      requestContext: { http: { method: 'GET' } },
      rawPath: '/api/instance/status',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      configured: false,
      state: 'unconfigured',
      workerReady: false,
      startable: false,
      message: 'GPU instance control is not configured.',
    });
  });
});

test('mock instance status can show a stopped local GPU without an EC2 id', async () => {
  const { handler } = await import(`./index.js?mockStatus=${Date.now()}`);

  await withEnv({
    GPU_INSTANCE_ID: '',
    GPU_INSTANCE_MOCK_STATE: 'stopped',
    GPU_WORKER_URL: 'http://localhost:3001',
  }, async () => {
    const response = await handler({
      requestContext: { http: { method: 'GET' } },
      rawPath: '/api/instance/status',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      configured: true,
      instanceId: 'local-mock-gpu',
      mock: true,
      state: 'stopped',
      workerReady: false,
      startable: true,
      started: false,
      message: 'Local mock GPU instance is stopped.',
    });
  });
});

test('mock instance start transitions local GPU to ready without calling EC2', async () => {
  const previousMockState = globalThis.__voiceCloningMockInstanceState;
  globalThis.__voiceCloningMockInstanceState = undefined;
  globalThis.__voiceCloningEc2Client = {
    async send() {
      throw new Error('EC2 should not be called in mock mode');
    },
  };

  const { handler } = await import(`./index.js?mockStart=${Date.now()}`);

  try {
    await withEnv({
      GPU_INSTANCE_ID: '',
      GPU_INSTANCE_MOCK_STATE: 'stopped',
      GPU_INSTANCE_MOCK_READY_DELAY_MS: '0',
      GPU_WORKER_URL: 'http://localhost:3001',
    }, async () => {
      const startResponse = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/instance/start',
      });

      assert.equal(startResponse.statusCode, 200);
      assert.deepEqual(JSON.parse(startResponse.body), {
        configured: true,
        instanceId: 'local-mock-gpu',
        mock: true,
        state: 'running',
        previousState: 'stopped',
        workerReady: true,
        startable: false,
        started: true,
        message: 'Local mock GPU instance is ready.',
      });

      const statusResponse = await handler({
        requestContext: { http: { method: 'GET' } },
        rawPath: '/api/instance/status',
      });

      assert.equal(statusResponse.statusCode, 200);
      assert.equal(JSON.parse(statusResponse.body).state, 'running');
      assert.equal(JSON.parse(statusResponse.body).workerReady, true);
    });
  } finally {
    if (previousMockState === undefined) {
      delete globalThis.__voiceCloningMockInstanceState;
    } else {
      globalThis.__voiceCloningMockInstanceState = previousMockState;
    }
    delete globalThis.__voiceCloningEc2Client;
  }
});

test('instance start only calls EC2 start when the user-triggered request finds a stopped instance', async () => {
  const calls = [];
  const fakeEc2 = {
    async send(command) {
      calls.push(command.constructor.name);
      if (command.constructor.name === 'DescribeInstancesCommand') {
        return {
          Reservations: [{
            Instances: [{
              InstanceId: 'i-1234567890abcdef0',
              State: { Name: 'stopped' },
            }],
          }],
        };
      }
      return {
        StartingInstances: [{
          InstanceId: 'i-1234567890abcdef0',
          CurrentState: { Name: 'pending' },
          PreviousState: { Name: 'stopped' },
        }],
      };
    },
  };

  globalThis.__voiceCloningEc2Client = fakeEc2;
  const { handler } = await import(`./index.js?start=${Date.now()}`);

  try {
    await withEnv({
      GPU_INSTANCE_ID: 'i-1234567890abcdef0',
      GPU_WORKER_URL: 'http://localhost:3001',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/instance/start',
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, ['DescribeInstancesCommand', 'StartInstancesCommand']);
      assert.deepEqual(JSON.parse(response.body), {
        configured: true,
        instanceId: 'i-1234567890abcdef0',
        state: 'pending',
        previousState: 'stopped',
        workerReady: false,
        startable: false,
        started: true,
      });
    });
  } finally {
    delete globalThis.__voiceCloningEc2Client;
  }
});

test('instance start is a no-op when the GPU instance is already running', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  globalThis.__voiceCloningEc2Client = {
    async send(command) {
      calls.push(command.constructor.name);
      return {
        Reservations: [{
          Instances: [{
            InstanceId: 'i-running',
            State: { Name: 'running' },
          }],
        }],
      };
    },
  };

  const { handler } = await import(`./index.js?running=${Date.now()}`);

  try {
    await withEnv({
      GPU_INSTANCE_ID: 'i-running',
      GPU_WORKER_URL: 'http://localhost:3001',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/instance/start',
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, ['DescribeInstancesCommand']);
      assert.equal(JSON.parse(response.body).started, false);
      assert.equal(JSON.parse(response.body).workerReady, true);
    });
  } finally {
    globalThis.fetch = previousFetch;
    delete globalThis.__voiceCloningEc2Client;
  }
});
