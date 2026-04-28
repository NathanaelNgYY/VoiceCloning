import {
  EC2Client,
  DescribeInstancesCommand,
  StartInstancesCommand,
} from '@aws-sdk/client-ec2';
import { ok, err, preflight } from '../shared/cors.js';

function instanceId() {
  return (process.env.GPU_INSTANCE_ID || '').trim();
}

function instanceRegion() {
  return (process.env.GPU_INSTANCE_REGION || process.env.AWS_REGION || 'ap-northeast-2').trim();
}

function workerUrl() {
  return (process.env.GPU_WORKER_URL || '').replace(/\/+$/u, '');
}

function createEc2Client() {
  return globalThis.__voiceCloningEc2Client || new EC2Client({ region: instanceRegion() });
}

function unconfiguredStatus() {
  return {
    configured: false,
    state: 'unconfigured',
    workerReady: false,
    startable: false,
    message: 'GPU instance control is not configured.',
  };
}

function normalizeState(response) {
  const instance = response?.Reservations?.flatMap((reservation) => reservation.Instances || [])?.[0];
  return instance?.State?.Name || 'unknown';
}

async function describeInstance(ec2, id) {
  const response = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [id] }));
  return normalizeState(response);
}

async function checkWorkerReady() {
  const baseUrl = workerUrl();
  if (!baseUrl) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${baseUrl}/healthz`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function statusPayload({ id, state, workerReady, started = false, previousState = null }) {
  const payload = {
    configured: true,
    instanceId: id,
    state,
    workerReady,
    startable: state === 'stopped',
  };

  if (previousState) {
    payload.previousState = previousState;
  }
  if (started) {
    payload.started = true;
  } else {
    payload.started = false;
  }

  return payload;
}

async function getStatus() {
  const id = instanceId();
  if (!id) return unconfiguredStatus();

  const ec2 = createEc2Client();
  const state = await describeInstance(ec2, id);
  const workerReady = state === 'running' ? await checkWorkerReady() : false;
  return statusPayload({ id, state, workerReady });
}

async function startInstance() {
  const id = instanceId();
  if (!id) {
    return {
      errorStatus: 400,
      body: unconfiguredStatus(),
    };
  }

  const ec2 = createEc2Client();
  const state = await describeInstance(ec2, id);

  if (state === 'running') {
    return {
      body: statusPayload({
        id,
        state,
        workerReady: await checkWorkerReady(),
      }),
    };
  }

  if (state !== 'stopped') {
    return {
      body: statusPayload({
        id,
        state,
        workerReady: false,
      }),
    };
  }

  const response = await ec2.send(new StartInstancesCommand({ InstanceIds: [id] }));
  const transition = response?.StartingInstances?.[0] || {};
  const nextState = transition.CurrentState?.Name || 'pending';
  const previousState = transition.PreviousState?.Name || state;

  return {
    body: statusPayload({
      id,
      state: nextState,
      previousState,
      workerReady: false,
      started: true,
    }),
  };
}

export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return preflight();
  }

  const method = event.requestContext?.http?.method;
  const routePath = event.rawPath || '';

  try {
    if (method === 'GET' && routePath.endsWith('/instance/status')) {
      return ok(await getStatus());
    }

    if (method === 'POST' && routePath.endsWith('/instance/start')) {
      const result = await startInstance();
      if (result.errorStatus) {
        return {
          ...err(result.errorStatus, result.body.message || 'GPU instance control is not configured.'),
          body: JSON.stringify(result.body),
        };
      }
      return ok(result.body);
    }

    return err(404, 'Not found');
  } catch (error) {
    return err(500, error.message);
  }
};
