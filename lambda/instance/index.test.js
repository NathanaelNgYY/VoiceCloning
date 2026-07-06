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

test('GPU instance mock env is ignored without a real EC2 id', async () => {
  const { handler } = await import(`./index.js?mockIgnored=${Date.now()}`);

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
      configured: false,
      state: 'unconfigured',
      workerReady: false,
      startable: false,
      message: 'GPU instance control is not configured.',
    });
  });
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

test('idle check stops a running GPU after configured idle minutes', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/activity/status')) {
      return new Response(JSON.stringify({
        busy: false,
        idleMs: 11 * 60 * 1000,
        lastActivityAt: Date.now() - (11 * 60 * 1000),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  globalThis.__voiceCloningEc2Client = {
    async send(command) {
      calls.push(command.constructor.name);
      if (command.constructor.name === 'DescribeInstancesCommand') {
        return {
          Reservations: [{
            Instances: [{
              InstanceId: 'i-idle',
              State: { Name: 'running' },
            }],
          }],
        };
      }
      return {};
    },
  };

  const { handler } = await import(`./index.js?idleStop=${Date.now()}`);

  try {
    await withEnv({
      GPU_INSTANCE_ID: 'i-idle',
      GPU_WORKER_URL: 'http://localhost:3001',
      GPU_IDLE_STOP_MINUTES: '10',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/instance/idle-check',
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, ['DescribeInstancesCommand', 'StopInstancesCommand']);
      const body = JSON.parse(response.body);
      assert.equal(body.checked, true);
      assert.equal(body.stopped, true);
      assert.equal(body.reason, 'idle-timeout');
      assert.equal(body.idleStopMinutes, 10);
    });
  } finally {
    globalThis.fetch = previousFetch;
    delete globalThis.__voiceCloningEc2Client;
  }
});

test('idle check does not stop a recently active busy running GPU', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/activity/status')) {
      return new Response(JSON.stringify({
        busy: true,
        idleMs: 2 * 60 * 1000,
        lastActivityAt: Date.now() - (2 * 60 * 1000),
        inferenceStatus: 'generating',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  globalThis.__voiceCloningEc2Client = {
    async send(command) {
      calls.push(command.constructor.name);
      return {
        Reservations: [{
          Instances: [{
            InstanceId: 'i-busy',
            State: { Name: 'running' },
          }],
        }],
      };
    },
  };

  const { handler } = await import(`./index.js?idleBusy=${Date.now()}`);

  try {
    await withEnv({
      GPU_INSTANCE_ID: 'i-busy',
      GPU_WORKER_URL: 'http://localhost:3001',
      GPU_IDLE_STOP_MINUTES: '10',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/instance/idle-check',
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, ['DescribeInstancesCommand']);
      const body = JSON.parse(response.body);
      assert.equal(body.checked, true);
      assert.equal(body.stopped, false);
      assert.equal(body.reason, 'worker-busy');
    });
  } finally {
    globalThis.fetch = previousFetch;
    delete globalThis.__voiceCloningEc2Client;
  }
});

test('idle check keeps the GPU running when the inference worker was recently active on a shared worker domain', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value === 'http://localhost:3001/activity/status') {
      return new Response(JSON.stringify({
        busy: false,
        idleMs: 11 * 60 * 1000,
        lastActivityAt: Date.now() - (11 * 60 * 1000),
        trainingStatus: 'idle',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (value === 'http://localhost:3001/inference/activity/status') {
      return new Response(JSON.stringify({
        busy: false,
        idleMs: 2 * 60 * 1000,
        lastActivityAt: Date.now() - (2 * 60 * 1000),
        inferenceStatus: 'idle',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  globalThis.__voiceCloningEc2Client = {
    async send(command) {
      calls.push(command.constructor.name);
      return {
        Reservations: [{
          Instances: [{
            InstanceId: 'i-inference-active',
            State: { Name: 'running' },
          }],
        }],
      };
    },
  };

  const { handler } = await import(`./index.js?inferenceRecent=${Date.now()}`);

  try {
    await withEnv({
      GPU_INSTANCE_ID: 'i-inference-active',
      GPU_WORKER_URL: 'http://localhost:3001',
      INFERENCE_WORKER_URL: 'http://localhost:3001',
      GPU_IDLE_STOP_MINUTES: '10',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/instance/idle-check',
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, ['DescribeInstancesCommand']);
      const body = JSON.parse(response.body);
      assert.equal(body.checked, true);
      assert.equal(body.stopped, false);
      assert.equal(body.reason, 'idle-threshold-not-met');
    });
  } finally {
    globalThis.fetch = previousFetch;
    delete globalThis.__voiceCloningEc2Client;
  }
});

test('schedule mode starts a stopped GPU inside the window and ignores activity', async () => {
  const calls = [];
  globalThis.__voiceCloningEc2Client = {
    async send(command) {
      calls.push(command.constructor.name);
      if (command.constructor.name === 'DescribeInstancesCommand') {
        return {
          Reservations: [{
            Instances: [{ InstanceId: 'i-sched', State: { Name: 'stopped' } }],
          }],
        };
      }
      return {};
    },
  };

  const { handler } = await import(`./index.js?schedStart=${Date.now()}`);

  try {
    await withEnv({
      GPU_INSTANCE_ID: 'i-sched',
      GPU_WORKER_URL: 'http://localhost:3001',
      GPU_SCHEDULE_ENABLED: 'true',
      GPU_SCHEDULE_START_HOUR: '0',
      GPU_SCHEDULE_END_HOUR: '24',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/instance/idle-check',
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, ['DescribeInstancesCommand', 'StartInstancesCommand']);
      const body = JSON.parse(response.body);
      assert.equal(body.mode, 'schedule');
      assert.equal(body.changed, true);
      assert.equal(body.reason, 'schedule-start');
    });
  } finally {
    delete globalThis.__voiceCloningEc2Client;
  }
});

test('schedule mode stops a running GPU outside the window, ignoring activity', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  // Even a busy worker must be stopped outside the window — activity is ignored.
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/activity/status')) {
      return new Response(JSON.stringify({
        busy: true,
        idleMs: 1 * 60 * 1000,
        lastActivityAt: Date.now(),
        inferenceStatus: 'generating',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  globalThis.__voiceCloningEc2Client = {
    async send(command) {
      calls.push(command.constructor.name);
      if (command.constructor.name === 'DescribeInstancesCommand') {
        return {
          Reservations: [{
            Instances: [{ InstanceId: 'i-sched', State: { Name: 'running' } }],
          }],
        };
      }
      return {};
    },
  };

  const { handler } = await import(`./index.js?schedStop=${Date.now()}`);

  try {
    await withEnv({
      GPU_INSTANCE_ID: 'i-sched',
      GPU_WORKER_URL: 'http://localhost:3001',
      GPU_SCHEDULE_ENABLED: 'true',
      // Empty window (start === end) is never "in window", so we're always outside it.
      GPU_SCHEDULE_START_HOUR: '9',
      GPU_SCHEDULE_END_HOUR: '9',
      GPU_IDLE_STOP_MINUTES: '10',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/instance/idle-check',
      });

      assert.equal(response.statusCode, 200);
      // No activity fetch at all; stops purely on the schedule.
      assert.deepEqual(calls, ['DescribeInstancesCommand', 'StopInstancesCommand']);
      const body = JSON.parse(response.body);
      assert.equal(body.mode, 'schedule');
      assert.equal(body.changed, true);
      assert.equal(body.reason, 'schedule-stop');
    });
  } finally {
    globalThis.fetch = previousFetch;
    delete globalThis.__voiceCloningEc2Client;
  }
});

test('schedule mode blocks an activity-triggered start outside the window', async () => {
  const calls = [];
  globalThis.__voiceCloningEc2Client = {
    async send(command) {
      calls.push(command.constructor.name);
      return {
        Reservations: [{
          Instances: [{ InstanceId: 'i-sched', State: { Name: 'stopped' } }],
        }],
      };
    },
  };

  const { handler } = await import(`./index.js?schedBlock=${Date.now()}`);

  try {
    await withEnv({
      GPU_INSTANCE_ID: 'i-sched',
      GPU_WORKER_URL: 'http://localhost:3001',
      GPU_SCHEDULE_ENABLED: 'true',
      GPU_SCHEDULE_START_HOUR: '9',
      GPU_SCHEDULE_END_HOUR: '9',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/instance/start',
      });

      assert.equal(response.statusCode, 200);
      // Describe only — no StartInstancesCommand.
      assert.deepEqual(calls, ['DescribeInstancesCommand']);
      const body = JSON.parse(response.body);
      assert.equal(body.scheduleBlocked, true);
      assert.equal(body.started, false);
    });
  } finally {
    delete globalThis.__voiceCloningEc2Client;
  }
});

test('idle check stops a stale busy GPU after configured idle minutes', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/activity/status')) {
      return new Response(JSON.stringify({
        busy: true,
        idleMs: 60 * 60 * 1000,
        lastActivityAt: Date.now() - (60 * 60 * 1000),
        trainingStatus: 'running',
        inferenceStatus: 'idle',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  globalThis.__voiceCloningEc2Client = {
    async send(command) {
      calls.push(command.constructor.name);
      if (command.constructor.name === 'DescribeInstancesCommand') {
        return {
          Reservations: [{
            Instances: [{
              InstanceId: 'i-stale-busy',
              State: { Name: 'running' },
            }],
          }],
        };
      }
      return {};
    },
  };

  const { handler } = await import(`./index.js?staleBusy=${Date.now()}`);

  try {
    await withEnv({
      GPU_INSTANCE_ID: 'i-stale-busy',
      GPU_WORKER_URL: 'http://localhost:3001',
      GPU_IDLE_STOP_MINUTES: '10',
    }, async () => {
      const response = await handler({
        requestContext: { http: { method: 'POST' } },
        rawPath: '/api/instance/idle-check',
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, ['DescribeInstancesCommand', 'StopInstancesCommand']);
      const body = JSON.parse(response.body);
      assert.equal(body.checked, true);
      assert.equal(body.stopped, true);
      assert.equal(body.reason, 'stale-busy-timeout');
    });
  } finally {
    globalThis.fetch = previousFetch;
    delete globalThis.__voiceCloningEc2Client;
  }
});
