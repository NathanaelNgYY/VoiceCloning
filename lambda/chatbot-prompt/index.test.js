import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, SYSTEM_PROMPT_KEY, MAX_PROMPT_CHARS } from './index.js';

function event(method, body) {
  return {
    requestContext: { http: { method } },
    rawPath: '/api/chatbot/system-prompt',
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function missingKeyError() {
  const error = new Error('NoSuchKey');
  error.name = 'NoSuchKey';
  return error;
}

test('GET returns an empty prompt when nothing is deployed yet', async () => {
  const handler = createHandler({
    readObject: async () => { throw missingKeyError(); },
    authGuard: null,
  });

  const response = await handler(event('GET'));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { prompt: '', updatedAt: '', updatedBy: '' });
});

test('GET returns the deployed prompt', async () => {
  const handler = createHandler({
    readObject: async (key) => {
      assert.equal(key, SYSTEM_PROMPT_KEY);
      return Buffer.from(JSON.stringify({
        prompt: 'Deployed instructions',
        updatedAt: '2026-08-13T00:00:00.000Z',
        updatedBy: 'editor@example.com',
      }));
    },
    authGuard: null,
  });

  const response = await handler(event('GET'));

  assert.deepEqual(JSON.parse(response.body), {
    prompt: 'Deployed instructions',
    updatedAt: '2026-08-13T00:00:00.000Z',
    updatedBy: 'editor@example.com',
  });
});

test('PUT stores the prompt with who deployed it', async () => {
  const writes = [];
  const handler = createHandler({
    writeObject: async (key, buffer, contentType) => { writes.push({ key, buffer, contentType }); },
    authGuard: { authorize: async () => ({ oid: 'abc', email: 'editor@example.com' }) },
    now: () => '2026-08-13T01:00:00.000Z',
  });

  const response = await handler(event('PUT', { prompt: 'New instructions' }));

  assert.equal(response.statusCode, 200);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, SYSTEM_PROMPT_KEY);
  assert.equal(writes[0].contentType, 'application/json');
  assert.deepEqual(JSON.parse(writes[0].buffer.toString('utf-8')), {
    schemaVersion: 1,
    prompt: 'New instructions',
    updatedAt: '2026-08-13T01:00:00.000Z',
    updatedBy: 'editor@example.com',
  });
});

test('PUT accepts the shared deploy key when the build has no sign-in', async () => {
  let wrote = null;
  const handler = createHandler({
    writeObject: async (_key, buffer) => { wrote = JSON.parse(buffer.toString('utf-8')); },
    authGuard: { authorize: async () => { throw new Error('no token'); } },
    deployKey: 's3cret',
  });

  const request = event('PUT', { prompt: 'Keyed instructions' });
  request.headers = { 'X-VCS-Deploy-Key': 's3cret' };
  const response = await handler(request);

  assert.equal(response.statusCode, 200);
  assert.equal(wrote.prompt, 'Keyed instructions');
  assert.equal(wrote.updatedBy, 'deploy-key');
});

test('PUT refuses a wrong deploy key', async () => {
  const handler = createHandler({
    writeObject: async () => { throw new Error('should not write'); },
    authGuard: { authorize: async () => { throw new Error('no token'); } },
    deployKey: 's3cret',
  });

  const request = event('PUT', { prompt: 'Keyed instructions' });
  request.headers = { 'X-VCS-Deploy-Key': 'wrong' };

  assert.equal((await handler(request)).statusCode, 401);
});

test('PUT refuses an unauthenticated caller when auth is configured', async () => {
  let wrote = false;
  const handler = createHandler({
    writeObject: async () => { wrote = true; },
    authGuard: { authorize: async () => { throw new Error('no token'); } },
  });

  const response = await handler(event('PUT', { prompt: 'New instructions' }));

  assert.equal(response.statusCode, 401);
  assert.equal(wrote, false);
});

test('PUT rejects an empty or oversized prompt', async () => {
  const handler = createHandler({
    writeObject: async () => { throw new Error('should not write'); },
    authGuard: null,
  });

  assert.equal((await handler(event('PUT', { prompt: '   ' }))).statusCode, 400);
  assert.equal((await handler(event('PUT', {}))).statusCode, 400);
  assert.equal(
    (await handler(event('PUT', { prompt: 'x'.repeat(MAX_PROMPT_CHARS + 1) }))).statusCode,
    413,
  );
});

test('unsupported methods are rejected', async () => {
  const handler = createHandler({ authGuard: null });
  assert.equal((await handler(event('DELETE'))).statusCode, 405);
});
