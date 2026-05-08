import {
  EC2Client,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
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

function idleStopMinutes() {
  const value = Number.parseFloat(process.env.GPU_IDLE_STOP_MINUTES || '0');
  return Number.isFinite(value) && value > 0 ? value : 0;
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

async function getWorkerActivityStatus() {
  const baseUrl = workerUrl();
  if (!baseUrl) {
    throw new Error('GPU_WORKER_URL is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${baseUrl}/activity/status`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Worker activity status returned ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
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

async function stopInstanceIfIdle() {
  const thresholdMinutes = idleStopMinutes();
  if (thresholdMinutes <= 0) {
    return {
      checked: false,
      stopped: false,
      reason: 'disabled',
      idleStopMinutes: 0,
    };
  }

  const id = instanceId();
  if (!id) {
    return {
      checked: false,
      stopped: false,
      reason: 'unconfigured',
      ...unconfiguredStatus(),
      idleStopMinutes: thresholdMinutes,
    };
  }

  const ec2 = createEc2Client();
  const state = await describeInstance(ec2, id);
  if (state !== 'running') {
    return {
      checked: true,
      stopped: false,
      reason: `instance-${state}`,
      instanceId: id,
      state,
      idleStopMinutes: thresholdMinutes,
    };
  }

  let activity;
  try {
    activity = await getWorkerActivityStatus();
  } catch (error) {
    return {
      checked: true,
      stopped: false,
      reason: 'worker-unreachable',
      instanceId: id,
      state,
      idleStopMinutes: thresholdMinutes,
      error: error.message,
    };
  }

  const thresholdMs = thresholdMinutes * 60 * 1000;
  const idleMs = Number.isFinite(Number(activity?.idleMs)) ? Number(activity.idleMs) : 0;

  if (activity?.busy && idleMs < thresholdMs) {
    return {
      checked: true,
      stopped: false,
      reason: 'worker-busy',
      instanceId: id,
      state,
      idleStopMinutes: thresholdMinutes,
      activity,
    };
  }

  if (idleMs < thresholdMs) {
    return {
      checked: true,
      stopped: false,
      reason: 'idle-threshold-not-met',
      instanceId: id,
      state,
      idleStopMinutes: thresholdMinutes,
      activity,
    };
  }

  await ec2.send(new StopInstancesCommand({ InstanceIds: [id] }));
  return {
    checked: true,
    stopped: true,
    reason: activity?.busy ? 'stale-busy-timeout' : 'idle-timeout',
    instanceId: id,
    state: 'stopping',
    previousState: state,
    idleStopMinutes: thresholdMinutes,
    activity,
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

    if ((method === 'POST' || method === 'GET') && routePath.endsWith('/instance/idle-check')) {
      return ok(await stopInstanceIfIdle());
    }

    return err(404, 'Not found');
  } catch (error) {
    return err(500, error.message);
  }
};
