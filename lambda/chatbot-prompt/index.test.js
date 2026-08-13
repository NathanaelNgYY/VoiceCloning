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
  });

  const response = await handler(event('GET'));

  assert.deepEqual(JSON.parse(response.body), {
    prompt: 'Deployed instructions',
    updatedAt: '2026-08-13T00:00:00.000Z',
    updatedBy: 'editor@example.com',
  });
});

test('PUT stores the prompt without requiring a signed-in caller', async () => {
  const writes = [];
  const handler = createHandler({
    writeObject: async (key, buffer, contentType) => { writes.push({ key, buffer, contentType }); },
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
  });
});

test('PUT rejects an empty or oversized prompt', async () => {
  const handler = createHandler({
    writeObject: async () => { throw new Error('should not write'); },
  });

  assert.equal((await handler(event('PUT', { prompt: '   ' }))).statusCode, 400);
  assert.equal((await handler(event('PUT', {}))).statusCode, 400);
  assert.equal(
    (await handler(event('PUT', { prompt: 'x'.repeat(MAX_PROMPT_CHARS + 1) }))).statusCode,
    413,
  );
});

test('unsupported methods are rejected', async () => {
  const handler = createHandler({});
  assert.equal((await handler(event('DELETE'))).statusCode, 405);
});
