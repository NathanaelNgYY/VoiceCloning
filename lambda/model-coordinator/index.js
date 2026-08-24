import crypto from 'node:crypto';
import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
  SetInstanceProtectionCommand,
  UpdateAutoScalingGroupCommand,
} from '@aws-sdk/client-auto-scaling';
import { DescribeInstancesCommand, EC2Client } from '@aws-sdk/client-ec2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { chooseCapacityAction } from './decision.js';

const region = process.env.AWS_REGION || 'ap-northeast-2';
const tableName = process.env.MODEL_COORDINATOR_TABLE || 'vcs-staging-model-workers';
const asgName = process.env.MODEL_COORDINATOR_ASG || 'vcs-staging-gpu-inference';
const authToken = String(process.env.MODEL_COORDINATOR_AUTH_TOKEN || '').trim();
const reassignIdleMs = Math.max(60_000, Number(process.env.MODEL_REASSIGN_IDLE_MS) || 300_000);
const bootEstimateSeconds = Math.max(60, Number(process.env.MODEL_BOOT_ESTIMATE_SECONDS) || 360);
const requestTimeoutMs = Math.max(5_000, Number(process.env.MODEL_WORKER_TIMEOUT_MS) || 110_000);
const pendingTtlMs = Math.max(120_000, Number(process.env.MODEL_PENDING_TTL_MS) || 600_000);

const autoscaling = new AutoScalingClient({ region });
const ec2 = new EC2Client({ region });
const document = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});

function clean(value) {
  return String(value || '').trim();
}

export function modelResidencyKey(body = {}) {
  const raw = body.voice_model && typeof body.voice_model === 'object' ? body.voice_model : {};
  const gptRef = clean(raw.gptRef);
  const sovitsRef = clean(raw.sovitsRef);
  if (!gptRef && !sovitsRef) return '';
  return crypto.createHash('sha256').update(JSON.stringify({ gptRef, sovitsRef })).digest('hex');
}

function workerUrl(worker, path) {
  return `http://${worker.privateIp}:3003${path}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = requestTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function coordinatorHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-VCS-Coordinator-Token': authToken,
    ...extra,
  };
}

async function scanState() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await document.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey }));
    items.push(...(page.Items || []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function probeWorker(worker) {
  try {
    const response = await fetchWithTimeout(workerUrl(worker, '/coordinator/status'), {
      headers: coordinatorHeaders(),
    }, 3_000);
    if (!response.ok) throw new Error(`status ${response.status}`);
    const status = await response.json();
    return {
      ...worker,
      reachable: true,
      state: status.draining ? 'DRAINING' : status.ready ? 'READY' : 'STARTING',
      modelKey: clean(status.modelKey),
      voiceProfileId: clean(status.voiceProfileId),
      active: Number(status.active) || 0,
      queued: Number(status.queued) || 0,
      maxSlots: Number(status.maxSlots) || 2,
      lastActivityAt: Number(status.lastActivityAt) || Date.now(),
    };
  } catch {
    return {
      ...worker,
      reachable: false,
      state: 'STARTING',
      active: 0,
      queued: 0,
      maxSlots: 2,
      lastActivityAt: worker.lastActivityAt || Date.now(),
    };
  }
}

async function refreshFleet(existingItems, now = Date.now()) {
  const existing = new Map(
    existingItems.filter((item) => item.entity === 'WORKER').map((item) => [item.instanceId, item]),
  );
  const fleet = await autoscaling.send(new DescribeAutoScalingGroupsCommand({
    AutoScalingGroupNames: [asgName],
  }));
  const group = fleet.AutoScalingGroups?.[0];
  if (!group) throw new Error(`Auto Scaling group ${asgName} was not found`);
  const candidates = (group.Instances || []).filter((item) =>
    ['InService', 'Pending', 'Pending:Wait', 'Pending:Proceed'].includes(item.LifecycleState));
  const ids = candidates.map((item) => item.InstanceId).filter(Boolean);
  if (ids.length === 0) return { group, workers: [] };

  const described = await ec2.send(new DescribeInstancesCommand({ InstanceIds: ids }));
  const instances = (described.Reservations || []).flatMap((reservation) => reservation.Instances || []);
  const workers = await Promise.all(instances.filter((instance) => instance.PrivateIpAddress).map(async (instance) => {
    const prior = existing.get(instance.InstanceId) || {};
    return probeWorker({
      ...prior,
      entity: 'WORKER',
      id: `WORKER#${instance.InstanceId}`,
      instanceId: instance.InstanceId,
      privateIp: instance.PrivateIpAddress,
      firstSeenAt: prior.firstSeenAt || now,
      updatedAt: now,
    });
  }));
  await Promise.all(workers.map((worker) => document.send(new PutCommand({
    TableName: tableName,
    Item: worker,
  }))));
  return { group, workers };
}

async function recordDemand(modelKey, voiceProfileId, now = Date.now()) {
  await document.send(new PutCommand({
    TableName: tableName,
    Item: {
      entity: 'MODEL',
      id: `MODEL#${modelKey}`,
      modelKey,
      voiceProfileId: clean(voiceProfileId),
      lastDemandAt: now,
      expiresAt: Math.floor((now + 86_400_000) / 1_000),
    },
  }));
}

function demandMap(items) {
  return Object.fromEntries(items
    .filter((item) => item.entity === 'MODEL' && item.modelKey)
    .map((item) => [item.modelKey, Number(item.lastDemandAt) || 0]));
}

async function assignWorker(worker, synthesisBody, { ignoreIdle = false } = {}) {
  await setWorkerProtection(worker.instanceId, true);
  try {
    const response = await fetchWithTimeout(workerUrl(worker, '/coordinator/assign'), {
      method: 'POST',
      headers: coordinatorHeaders(),
      body: JSON.stringify({
        synthesisBody,
        requiredIdleMs: ignoreIdle ? 0 : reassignIdleMs,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Worker assignment failed (${response.status})`);
      error.statusCode = response.status;
      error.retryAfterMs = data.retryAfterMs;
      throw error;
    }
    return { ...worker, ...data.status, state: 'READY', reachable: true };
  } finally {
    await setWorkerProtection(worker.instanceId, false).catch(() => {});
  }
}

async function setWorkerProtection(instanceId, protectedFromScaleIn) {
  if (!instanceId) return;
  await autoscaling.send(new SetInstanceProtectionCommand({
    AutoScalingGroupName: asgName,
    InstanceIds: [instanceId],
    ProtectedFromScaleIn: protectedFromScaleIn,
  }));
}

async function forwardSynthesis(worker, routePath, body, headers = {}) {
  const replyToken = clean(headers['X-VCS-Reply-Token'] || headers['x-vcs-reply-token']);
  if (replyToken) {
    await document.send(new PutCommand({
      TableName: tableName,
      Item: {
        entity: 'REPLY',
        id: `REPLY#${replyToken}`,
        replyToken,
        instanceId: worker.instanceId,
        privateIp: worker.privateIp,
        expiresAt: Math.floor((Date.now() + 120_000) / 1_000),
      },
    }));
  }
  await setWorkerProtection(worker.instanceId, true);
  try {
    const response = await fetchWithTimeout(workerUrl(worker, routePath), {
      method: 'POST',
      headers: coordinatorHeaders({
        'X-VCS-Coordinator-Direct': '1',
        ...headers,
      }),
      body: JSON.stringify(body),
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      let message = `Worker request failed (${response.status})`;
      try { message = JSON.parse(buffer.toString('utf8')).error || message; } catch { /* binary/empty */ }
      const error = new Error(message);
      error.statusCode = response.status;
      throw error;
    }
    return {
      statusCode: response.status,
      bodyBase64: buffer.toString('base64'),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      queueWaitMs: response.headers.get('x-synthesis-queue-wait-ms'),
      workerId: worker.instanceId,
    };
  } finally {
    if (replyToken) {
      await document.send(new DeleteCommand({ TableName: tableName, Key: { id: `REPLY#${replyToken}` } })).catch(() => {});
    }
    try {
      const current = await probeWorker(worker);
      if (current.active === 0 && current.queued === 0 && current.state !== 'DRAINING') {
        await setWorkerProtection(worker.instanceId, false);
      }
    } catch { /* retain protection when worker state is unknown */ }
  }
}

async function requestScale(group, modelKey, synthesisBody, now = Date.now()) {
  const pendingId = `PENDING#${modelKey}`;
  const existing = await document.send(new GetCommand({ TableName: tableName, Key: { id: pendingId } }));
  if (existing.Item && now - Number(existing.Item.requestedAt || 0) < pendingTtlMs) {
    return { started: false, pending: existing.Item };
  }
  const desired = Number(group.DesiredCapacity) || 0;
  const maximum = Number(group.MaxSize) || desired;
  if (desired >= maximum) return { started: false, atMaximum: true };
  const pending = {
    entity: 'PENDING',
    id: pendingId,
    modelKey,
    synthesisBody,
    requestedAt: now,
    expiresAt: Math.floor((now + pendingTtlMs) / 1_000),
  };
  await document.send(new PutCommand({ TableName: tableName, Item: pending }));
  await autoscaling.send(new UpdateAutoScalingGroupCommand({
    AutoScalingGroupName: asgName,
    DesiredCapacity: Math.min(maximum, desired + 1),
  }));
  return { started: true, pending };
}

export function bootAssignmentClaimable(item, instanceId, now = Date.now()) {
  return item?.entity === 'PENDING'
    && Boolean(item.synthesisBody)
    && now - Number(item.requestedAt || 0) < pendingTtlMs
    && (!item.claimedBy || item.claimedBy === instanceId || Number(item.claimExpiresAt || 0) < now);
}

async function claimBootAssignment(instanceId, now = Date.now()) {
  if (!instanceId) return { statusCode: 400, error: 'instanceId is required' };
  const items = await scanState();
  const pending = items
    .filter((item) => bootAssignmentClaimable(item, instanceId, now))
    .sort((left, right) => Number(left.requestedAt || 0) - Number(right.requestedAt || 0));

  for (const candidate of pending) {
    try {
      const claimed = await document.send(new UpdateCommand({
        TableName: tableName,
        Key: { id: candidate.id },
        UpdateExpression: 'SET claimedBy = :instanceId, claimExpiresAt = :claimExpiresAt',
        ConditionExpression: 'attribute_not_exists(claimedBy) OR claimedBy = :instanceId OR claimExpiresAt < :now',
        ExpressionAttributeValues: {
          ':instanceId': instanceId,
          ':claimExpiresAt': now + pendingTtlMs,
          ':now': now,
        },
        ReturnValues: 'ALL_NEW',
      }));
      return { statusCode: 200, assignment: claimed.Attributes };
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') throw error;
    }
  }
  return { statusCode: 200, assignment: null };
}

async function cancelReply(replyToken) {
  const result = await document.send(new GetCommand({
    TableName: tableName,
    Key: { id: `REPLY#${replyToken}` },
  }));
  if (!result.Item?.privateIp) return { freed: 0 };
  const response = await fetchWithTimeout(`http://${result.Item.privateIp}:3003/live/cancel`, {
    method: 'POST',
    headers: coordinatorHeaders(),
    body: JSON.stringify({ replyToken }),
  }, 5_000);
  return response.json().catch(() => ({ freed: 0 }));
}

async function synthesize(event) {
  const body = event.body || {};
  const routePath = clean(event.routePath) || '/inference/tts';
  const modelKey = modelResidencyKey(body);
  if (!modelKey) return { statusCode: 400, error: 'The request has no immutable GPT/SoVITS model pair.' };
  const now = Date.now();
  const model = body.voice_model || {};
  const existing = await scanState();
  await recordDemand(modelKey, model.voiceProfileId, now);
  const { group, workers } = await refreshFleet(existing, now);
  const pending = existing.find((item) => item.id === `PENDING#${modelKey}` && now - item.requestedAt < pendingTtlMs);
  let selected;

  if (pending) {
    const bootWarmed = workers.find((worker) =>
      worker.reachable
      && worker.state === 'READY'
      && worker.modelKey === modelKey
      && worker.active + worker.queued < worker.maxSlots);
    if (bootWarmed) {
      selected = bootWarmed;
      await document.send(new DeleteCommand({ TableName: tableName, Key: { id: pending.id } }));
    }
    const fresh = !selected && workers.find((worker) =>
      worker.reachable && worker.active === 0 && worker.queued === 0 && worker.firstSeenAt >= pending.requestedAt);
    if (fresh) {
      try {
        selected = await assignWorker(fresh, pending.synthesisBody || body, { ignoreIdle: true });
        await document.send(new DeleteCommand({ TableName: tableName, Key: { id: pending.id } }));
      } catch { /* keep pending and continue through ordinary selection */ }
    }
  }

  if (!selected) {
    const action = chooseCapacityAction({
      workers,
      requestedModelKey: modelKey,
      lastDemandByModel: demandMap(existing),
      now,
      reassignIdleMs,
    });
    if (action.type === 'route') selected = action.worker;
    if (action.type === 'reassign') {
      try {
        selected = await assignWorker(action.worker, body);
      } catch (error) {
        if (![409, 503].includes(error.statusCode)) throw error;
      }
    }
  }

  if (selected) {
    try {
      return await forwardSynthesis(selected, routePath, body, event.headers || {});
    } catch (error) {
      if (![429, 503].includes(error.statusCode)) throw error;
      // A live race consumed the final slot; fall through to scale instead of
      // queueing a third request on a nominal two-slot worker.
    }
  }

  const scale = await requestScale(group, modelKey, body, now);
  return {
    statusCode: 503,
    code: scale.atMaximum ? 'MODEL_CAPACITY_LIMIT' : 'MODEL_CAPACITY_STARTING',
    error: scale.atMaximum
      ? 'No GPU is available for this lecture voice and staging is at its capacity limit.'
      : 'This lecture voice is preparing on a GPU. You can wait or use another lecture meanwhile.',
    retryAfterSeconds: scale.atMaximum ? 30 : bootEstimateSeconds,
    scaleStarted: scale.started,
    voiceProfileId: clean(model.voiceProfileId),
    modelKey,
  };
}

export async function handler(event = {}) {
  try {
    if (event.action === 'claim') return claimBootAssignment(clean(event.instanceId));
    if (event.action === 'cancel') return cancelReply(clean(event.replyToken));
    if (event.action === 'status') {
      const existing = await scanState();
      const { group, workers } = await refreshFleet(existing);
      return { statusCode: 200, desiredCapacity: group.DesiredCapacity, workers };
    }
    if (event.action === 'synthesize') return synthesize(event);
    return { statusCode: 400, error: 'Unknown coordinator action' };
  } catch (error) {
    console.error('[model-coordinator]', error);
    return { statusCode: Number(error.statusCode) || 500, error: error.message };
  }
}
