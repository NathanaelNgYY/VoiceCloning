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
  });
});
