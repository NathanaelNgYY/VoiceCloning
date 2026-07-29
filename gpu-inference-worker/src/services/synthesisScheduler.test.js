import assert from 'node:assert/strict';
import test from 'node:test';
import { SynthesisQueueError, SynthesisScheduler } from './synthesisScheduler.js';

test('queues same-model work in FIFO order at concurrency one', async () => {
  let now = 10;
  const scheduler = new SynthesisScheduler({ maxConcurrency: 1, maxQueueDepth: 3, maxWaitMs: 1000, now: () => now });
  const first = await scheduler.acquire({ modelKey: 'dean' });
  const secondPromise = scheduler.acquire({ modelKey: 'dean' });
  assert.equal(scheduler.getStats().queued, 1);
  now = 25;
  first.release();
  const second = await secondPromise;
  assert.equal(second.queueWaitMs, 15);
  second.release();
});

test('never overlaps different model snapshots', async () => {
  const scheduler = new SynthesisScheduler({ maxConcurrency: 2, maxQueueDepth: 3, maxWaitMs: 1000 });
  const first = await scheduler.acquire({ modelKey: 'voice-a' });
  const same = await scheduler.acquire({ modelKey: 'voice-a' });
  const differentPromise = scheduler.acquire({ modelKey: 'voice-b' });
  assert.equal(scheduler.getStats().active, 2);
  assert.equal(scheduler.getStats().queued, 1);
  first.release();
  assert.equal(scheduler.getStats().active, 1);
  same.release();
  const different = await differentPromise;
  assert.equal(different.modelKey, 'voice-b');
  different.release();
});

test('rejects arrivals when the bounded queue is full', async () => {
  const scheduler = new SynthesisScheduler({ maxConcurrency: 1, maxQueueDepth: 1, maxWaitMs: 1000 });
  const active = await scheduler.acquire({ modelKey: 'dean' });
  const queued = scheduler.acquire({ modelKey: 'dean' });
  await assert.rejects(
    scheduler.acquire({ modelKey: 'dean' }),
    (error) => error instanceof SynthesisQueueError && error.statusCode === 429,
  );
  active.release();
  (await queued).release();
});

test('capacity retries are FIFO within a priority lane ahead of normal queued work', async () => {
  const scheduler = new SynthesisScheduler({
    maxConcurrency: 1,
    maxQueueDepth: 4,
    maxWaitMs: 1000,
  });
  const order = [];
  const active = await scheduler.acquire({ modelKey: 'dean' });
  const normal = scheduler.acquire({ modelKey: 'dean' }).then((lease) => {
    order.push('normal');
    lease.release();
  });
  const retryOne = scheduler.acquire({ modelKey: 'dean', priority: true }).then((lease) => {
    order.push('retry-one');
    lease.release();
  });
  const retryTwo = scheduler.acquire({ modelKey: 'dean', priority: true }).then((lease) => {
    order.push('retry-two');
    lease.release();
  });

  assert.equal(scheduler.getStats().priorityQueued, 2);
  active.release();
  await Promise.all([normal, retryOne, retryTwo]);
  assert.deepEqual(order, ['retry-one', 'retry-two', 'normal']);
});
