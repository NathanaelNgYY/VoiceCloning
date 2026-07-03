import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from './index.js';

test('config handler reports serverless S3 remote mode', async () => {
  const response = await handler({
    requestContext: { http: { method: 'GET' } },
    rawPath: '/api/config',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    storageMode: 's3',
    inferenceMode: 'remote',
    liveDemoLockout: false,
  });
});

test('config handler reports lockout when LIVE_DEMO_LOCKOUT is set', async () => {
  const prev = process.env.LIVE_DEMO_LOCKOUT;
  process.env.LIVE_DEMO_LOCKOUT = 'true';
  try {
    const response = await handler({
      requestContext: { http: { method: 'GET' } },
      rawPath: '/api/config',
    });
    assert.equal(JSON.parse(response.body).liveDemoLockout, true);
  } finally {
    if (prev === undefined) delete process.env.LIVE_DEMO_LOCKOUT;
    else process.env.LIVE_DEMO_LOCKOUT = prev;
  }
});
