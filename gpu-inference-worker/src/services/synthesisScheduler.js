import {
  SYNTHESIS_MAX_CONCURRENCY,
  SYNTHESIS_MAX_QUEUE_DEPTH,
  SYNTHESIS_MAX_QUEUE_WAIT_MS,
} from '../config.js';

export class SynthesisQueueError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.name = 'SynthesisQueueError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizedModelKey(value) {
  return String(value || '').trim() || '__current_model__';
}

export class SynthesisScheduler {
  constructor({
    maxConcurrency = SYNTHESIS_MAX_CONCURRENCY,
    maxQueueDepth = SYNTHESIS_MAX_QUEUE_DEPTH,
    maxWaitMs = SYNTHESIS_MAX_QUEUE_WAIT_MS,
    now = () => Date.now(),
  } = {}) {
    this.maxConcurrency = maxConcurrency;
    this.maxQueueDepth = maxQueueDepth;
    this.maxWaitMs = maxWaitMs;
    this.now = now;
    this.active = 0;
    this.activeModelKey = '';
    this.queue = [];
  }

  getStats() {
    return {
      active: this.active,
      queued: this.queue.length,
      maxConcurrency: this.maxConcurrency,
      maxQueueDepth: this.maxQueueDepth,
      activeModelKey: this.activeModelKey || null,
    };
  }

  canStart(modelKey) {
    if (this.active >= this.maxConcurrency) return false;
    return this.active === 0 || this.activeModelKey === modelKey;
  }

  acquire({ modelKey, signal } = {}) {
    const normalizedKey = normalizedModelKey(modelKey);
    if (signal?.aborted) {
      return Promise.reject(new SynthesisQueueError(499, 'Request was cancelled while waiting for the GPU', 'QUEUE_ABORTED'));
    }

    // Preserve FIFO once anyone is waiting. New arrivals must not continually skip
    // a queued request just because they happen to match the currently active voice.
    if (this.queue.length === 0 && this.canStart(normalizedKey)) {
      return Promise.resolve(this.startLease(normalizedKey, this.now()));
    }
    if (this.queue.length >= this.maxQueueDepth) {
      return Promise.reject(new SynthesisQueueError(
        429,
        'The synthesis queue is full. Please retry shortly.',
        'QUEUE_FULL',
      ));
    }

    return new Promise((resolve, reject) => {
      const entry = {
        modelKey: normalizedKey,
        enqueuedAt: this.now(),
        resolve,
        reject,
        timeout: null,
        onAbort: null,
      };
      const remove = () => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
      };
      entry.timeout = setTimeout(() => {
        remove();
        signal?.removeEventListener('abort', entry.onAbort);
        reject(new SynthesisQueueError(
          503,
          'Timed out waiting for an available GPU worker.',
          'QUEUE_TIMEOUT',
        ));
        this.drain();
      }, this.maxWaitMs);
      entry.timeout.unref?.();
      entry.onAbort = () => {
        remove();
        clearTimeout(entry.timeout);
        reject(new SynthesisQueueError(499, 'Request was cancelled while waiting for the GPU', 'QUEUE_ABORTED'));
        this.drain();
      };
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      this.queue.push(entry);
      this.drain();
    });
  }

  startLease(modelKey, enqueuedAt) {
    if (this.active === 0) this.activeModelKey = modelKey;
    this.active += 1;
    const startedAt = this.now();
    let released = false;
    return {
      modelKey,
      queueWaitMs: Math.max(0, startedAt - enqueuedAt),
      release: () => {
        if (released) return;
        released = true;
        this.active = Math.max(0, this.active - 1);
        if (this.active === 0) this.activeModelKey = '';
        this.drain();
      },
    };
  }

  drain() {
    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (!this.canStart(next.modelKey)) return;
      this.queue.shift();
      clearTimeout(next.timeout);
      const lease = this.startLease(next.modelKey, next.enqueuedAt);
      next.resolve(lease);
      // A different model can never join the active batch. Same-model entries may
      // fill the remaining tested concurrency slots.
    }
  }
}

export const synthesisScheduler = new SynthesisScheduler();
