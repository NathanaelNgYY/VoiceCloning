import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyResidencyLocks,
  chooseCapacityAction,
  choosePreparationAction,
  chooseQueuedMatchingWorker,
  matchingFreeSlots,
} from './decision.js';

const now = 1_000_000;
const worker = (overrides = {}) => ({
  instanceId: 'i-1',
  state: 'READY',
  reachable: true,
  modelKey: 'dean',
  voiceProfileId: 'deanvoice-v1',
  active: 0,
  queued: 0,
  maxSlots: 2,
  firstSeenAt: now - 900_000,
  lastActivityAt: now - 600_000,
  ...overrides,
});

test('routes to a matching free slot before considering reassignment', () => {
  const result = chooseCapacityAction({
    requestedModelKey: 'dean-v2',
    now,
    workers: [
      worker({ instanceId: 'i-dean', modelKey: 'dean' }),
      worker({ instanceId: 'i-v2', modelKey: 'dean-v2', active: 1 }),
    ],
  });
  assert.equal(result.type, 'route');
  assert.equal(result.worker.instanceId, 'i-v2');
});

test('reassigns an idle worker when the matching pool is full', () => {
  const result = chooseCapacityAction({
    requestedModelKey: 'dean-v2',
    now,
    reassignIdleMs: 300_000,
    workers: [
      worker({ instanceId: 'i-v2', modelKey: 'dean-v2', active: 2 }),
      worker({ instanceId: 'i-dean', modelKey: 'dean' }),
    ],
  });
  assert.equal(result.type, 'reassign');
  assert.equal(result.worker.instanceId, 'i-dean');
});

test('reassigns an idle worker immediately for a sequential request to another voice', () => {
  const result = chooseCapacityAction({
    requestedModelKey: 'dean-v2',
    now,
    reassignIdleMs: 0,
    lastDemandByModel: { dean: now - 30_000 },
    workers: [worker({ modelKey: 'dean' })],
  });
  assert.equal(result.type, 'reassign');
  assert.equal(result.worker.instanceId, 'i-1');
});

test('assigns a base-ready worker that has no resident model yet', () => {
  const worker = {
    instanceId: 'i-unassigned',
    state: 'UNASSIGNED',
    reachable: true,
    modelKey: '',
    active: 0,
    queued: 0,
    maxSlots: 2,
    lastActivityAt: 0,
  };

  const result = chooseCapacityAction({
    workers: [worker],
    requestedModelKey: 'dean-model',
    now: 10_000,
    reassignIdleMs: 0,
  });

  assert.equal(result.type, 'reassign');
  assert.equal(result.worker.instanceId, 'i-unassigned');
});

test('a positive event residency window can protect a recently demanded voice', () => {
  const result = chooseCapacityAction({
    requestedModelKey: 'dean-v2',
    now,
    reassignIdleMs: 300_000,
    lastDemandByModel: { dean: now - 30_000 },
    workers: [worker({ modelKey: 'dean' })],
  });
  assert.equal(result.type, 'scale');
});

test('does not reassign busy or queued workers', () => {
  const result = chooseCapacityAction({
    requestedModelKey: 'dean-v2',
    now,
    workers: [
      worker({ active: 1 }),
      worker({ instanceId: 'i-queued', queued: 1 }),
    ],
  });
  assert.equal(result.type, 'scale');
});

test('counts only free slots on reachable ready matching workers', () => {
  assert.equal(matchingFreeSlots([
    worker({ modelKey: 'dean-v2', active: 1 }),
    worker({ instanceId: 'i-v2-2', modelKey: 'dean-v2', active: 0 }),
    worker({ instanceId: 'i-other', modelKey: 'dean' }),
    worker({ instanceId: 'i-starting', modelKey: 'dean-v2', state: 'STARTING' }),
  ], 'dean-v2'), 3);
});

test('packs matching work onto the oldest worker so newer capacity can scale in', () => {
  const result = chooseCapacityAction({
    requestedModelKey: 'dean',
    now,
    workers: [
      worker({ instanceId: 'i-new', firstSeenAt: now - 60_000, active: 1 }),
      worker({ instanceId: 'i-old', firstSeenAt: now - 900_000, active: 0 }),
    ],
  });

  assert.equal(result.type, 'route');
  assert.equal(result.worker.instanceId, 'i-old');
});

test('does not route to a worker whose queued work consumes its final slot', () => {
  const result = chooseCapacityAction({
    requestedModelKey: 'dean',
    now,
    workers: [
      worker({ instanceId: 'i-full', active: 1, queued: 1 }),
      worker({ instanceId: 'i-free', firstSeenAt: now - 60_000, active: 0, queued: 0 }),
    ],
  });

  assert.equal(result.type, 'route');
  assert.equal(result.worker.instanceId, 'i-free');
});

test('event residency minimum protects only the oldest required workers', () => {
  const workers = applyResidencyLocks([
    worker({ instanceId: 'i-old', firstSeenAt: now - 900_000 }),
    worker({ instanceId: 'i-new', firstSeenAt: now - 60_000 }),
  ], [{
    entity: 'RESIDENCY_LOCK',
    voiceProfileId: 'deanvoice-v1',
    minimumWorkers: 1,
  }], now);

  assert.equal(workers.find((item) => item.instanceId === 'i-old').residencyLocked, true);
  assert.notEqual(workers.find((item) => item.instanceId === 'i-new').residencyLocked, true);
  const result = chooseCapacityAction({
    requestedModelKey: 'alex',
    workers,
    now,
  });
  assert.equal(result.type, 'reassign');
  assert.equal(result.worker.instanceId, 'i-new');
});

test('event residency minimum makes the last protected voice worker unavailable', () => {
  const workers = applyResidencyLocks([worker()], [{
    entity: 'RESIDENCY_LOCK',
    voiceProfileId: 'deanvoice-v1',
    minimumWorkers: 1,
  }], now);

  assert.equal(chooseCapacityAction({
    requestedModelKey: 'alex',
    workers,
    now,
  }).type, 'scale');
});

test('expired event residency locks do not protect workers', () => {
  const workers = applyResidencyLocks([worker()], [{
    entity: 'RESIDENCY_LOCK',
    voiceProfileId: 'deanvoice-v1',
    minimumWorkers: 1,
    expiresAt: Math.floor((now - 1) / 1_000),
  }], now);

  assert.notEqual(workers[0].residencyLocked, true);
});

test('model selection defers instead of scaling while the only GPU is warming', () => {
  const result = choosePreparationAction({
    requestedModelKey: 'dean',
    now,
    workers: [worker({ modelKey: 'alex', state: 'STARTING', active: 0, queued: 0 })],
  });

  assert.deepEqual(result, { type: 'defer' });
});

test('explicit event preparation may scale while the only GPU is warming', () => {
  const result = choosePreparationAction({
    requestedModelKey: 'dean',
    now,
    allowScale: true,
    workers: [worker({ modelKey: 'alex', state: 'STARTING', active: 0, queued: 0 })],
  });

  assert.deepEqual(result, { type: 'scale' });
});

test('model selection still reassigns an existing idle GPU without scaling', () => {
  const result = choosePreparationAction({
    requestedModelKey: 'dean-v2',
    now,
    workers: [worker({ modelKey: 'dean' })],
  });

  assert.equal(result.type, 'reassign');
  assert.equal(result.worker.instanceId, 'i-1');
});

test('queues on the least-loaded resident worker when every matching slot is occupied', () => {
  const selected = chooseQueuedMatchingWorker([
    worker({ instanceId: 'i-busier', active: 2, queued: 2 }),
    worker({ instanceId: 'i-next', active: 2, queued: 0 }),
    worker({ instanceId: 'i-other-model', modelKey: 'alex', active: 0 }),
  ], 'dean');

  assert.equal(selected.instanceId, 'i-next');
});

test('does not queue an absent model on a worker holding different weights', () => {
  assert.equal(chooseQueuedMatchingWorker([
    worker({ modelKey: 'alex', active: 2 }),
  ], 'dean'), null);
});
