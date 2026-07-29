import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchInferenceWithCapacityRetry } from './gpuWorker.js';

function response(status, retryAfter = '') {
  return {
    status,
    headers: new Headers(retryAfter ? { 'Retry-After': retryAfter } : {}),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

test('capacity retry marks only retry attempts for worker priority', async () => {
  const previousUrl = process.env.INFERENCE_WORKER_URL;
  process.env.INFERENCE_WORKER_URL = 'https://inference.example';
  const requests = [];
  let clock = 0;
  try {
    const result = await fetchInferenceWithCapacityRetry('/inference/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }, {
      fetchImpl: async (_url, options) => {
        requests.push(options);
        return requests.length < 3 ? response(503) : response(200);
      },
      waitImpl: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });

    assert.equal(result.status, 200);
    assert.equal(requests[0].headers['X-VCS-Capacity-Retry'], undefined);
    assert.equal(requests[1].headers['X-VCS-Capacity-Retry'], '1');
    assert.equal(requests[2].headers['X-VCS-Capacity-Retry'], '2');
  } finally {
    if (previousUrl == null) delete process.env.INFERENCE_WORKER_URL;
    else process.env.INFERENCE_WORKER_URL = previousUrl;
  }
});
