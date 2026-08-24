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

test('coordinator direct admission rejects instead of creating a third queued slot', async () => {
  const scheduler = new SynthesisScheduler({ maxConcurrency: 2, maxQueueDepth: 5, maxWaitMs: 1000 });
  const first = await scheduler.acquire({ modelKey: 'dean' });
  const second = await scheduler.acquire({ modelKey: 'dean' });
  await assert.rejects(
    scheduler.acquire({ modelKey: 'dean', allowQueue: false }),
    (error) => error instanceof SynthesisQueueError
      && error.statusCode === 503
      && error.code === 'NO_FREE_SLOT',
  );
  assert.equal(scheduler.getStats().queued, 0);
  first.release();
  second.release();
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

test('barge-in frees only the abandoned reply\'s queued clips', async () => {
  const scheduler = new SynthesisScheduler({ maxConcurrency: 1, maxQueueDepth: 5, maxWaitMs: 1000 });
  const active = await scheduler.acquire({ modelKey: 'dean' });
  const doomed = scheduler.acquire({ modelKey: 'dean', cancelKey: 'reply-a' });
  const survivor = scheduler.acquire({ modelKey: 'dean', cancelKey: 'reply-b' });
  assert.equal(scheduler.getStats().queued, 2);

  assert.equal(scheduler.cancel('reply-a'), 1);
  await assert.rejects(
    doomed,
    (error) => error instanceof SynthesisQueueError
      && error.statusCode === 499
      && error.code === 'REPLY_CANCELLED',
  );
  assert.equal(scheduler.getStats().queued, 1);

  active.release();
  (await survivor).release();
});

test('a cancel that overtakes its own clip request rejects it on arrival', async () => {
  // The cancel goes straight to the worker while the clip it cancels is still
  // crossing the Lambda hop, so the clip can arrive after the cancel.
  const scheduler = new SynthesisScheduler({ maxConcurrency: 1, maxQueueDepth: 5, maxWaitMs: 1000 });
  scheduler.cancel('reply-a');

  await assert.rejects(
    scheduler.acquire({ modelKey: 'dean', cancelKey: 'reply-a' }),
    (error) => error instanceof SynthesisQueueError
      && error.statusCode === 499
      && error.code === 'REPLY_CANCELLED',
  );
  // An idle GPU must still be handed to everyone else.
  assert.equal(scheduler.getStats().active, 0);
  (await scheduler.acquire({ modelKey: 'dean', cancelKey: 'reply-b' })).release();
});

test('cancelling cannot stop a clip already synthesizing on the GPU', async () => {
  // GPT-SoVITS synthesis is a blocking call: once a clip holds a lease, barge-in
  // can only stop the clips behind it.
  const scheduler = new SynthesisScheduler({ maxConcurrency: 1, maxQueueDepth: 5, maxWaitMs: 1000 });
  const running = await scheduler.acquire({ modelKey: 'dean', cancelKey: 'reply-a' });

  assert.equal(scheduler.cancel('reply-a'), 0);
  assert.equal(scheduler.getStats().active, 1);
  running.release();
});

test('cancelled reply keys are pruned once their TTL lapses', async () => {
  let now = 0;
  const scheduler = new SynthesisScheduler({ maxConcurrency: 1, maxQueueDepth: 5, maxWaitMs: 1000, now: () => now });
  scheduler.cancel('reply-a');
  assert.equal(scheduler.isCancelledKey('reply-a'), true);

  now = 30_001;
  assert.equal(scheduler.isCancelledKey('reply-a'), false);
  assert.equal(scheduler.cancelledKeys.size, 0);
});

test('cancelling without a token is a no-op and never blocks untagged work', async () => {
  const scheduler = new SynthesisScheduler({ maxConcurrency: 1, maxQueueDepth: 5, maxWaitMs: 1000 });
  assert.equal(scheduler.cancel(''), 0);
  assert.equal(scheduler.cancel(undefined), 0);
  assert.equal(scheduler.isCancelledKey(''), false);

  (await scheduler.acquire({ modelKey: 'dean' })).release();
});
