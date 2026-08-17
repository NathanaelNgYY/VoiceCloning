import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHandler,
  SYSTEM_PROMPT_KEY,
  MAX_PROMPT_CHARS,
  MAX_DOCUMENTS_CHARS,
  MAX_DOCUMENTS,
} from './index.js';

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
  assert.deepEqual(JSON.parse(response.body), {
    prompt: '', documents: [], updatedAt: '', updatedBy: '',
  });
});

test('GET returns the deployed prompt and documents', async () => {
  const handler = createHandler({
    readObject: async (key) => {
      assert.equal(key, SYSTEM_PROMPT_KEY);
      return Buffer.from(JSON.stringify({
        schemaVersion: 2,
        prompt: 'Deployed instructions',
        documents: [{ name: 'paper.pdf', text: 'Findings.' }],
        updatedAt: '2026-08-13T00:00:00.000Z',
        updatedBy: 'editor@example.com',
      }));
    },
  });

  const response = await handler(event('GET'));

  assert.deepEqual(JSON.parse(response.body), {
    prompt: 'Deployed instructions',
    documents: [{ name: 'paper.pdf', text: 'Findings.' }],
    updatedAt: '2026-08-13T00:00:00.000Z',
    updatedBy: 'editor@example.com',
  });
});

test('GET reads a schemaVersion 1 record as a prompt with no documents', async () => {
  const handler = createHandler({
    readObject: async () => Buffer.from(JSON.stringify({
      schemaVersion: 1,
      prompt: 'Older deploy',
      updatedAt: '2026-08-01T00:00:00.000Z',
    })),
  });

  const response = await handler(event('GET'));

  assert.deepEqual(JSON.parse(response.body), {
    prompt: 'Older deploy',
    documents: [],
    updatedAt: '2026-08-01T00:00:00.000Z',
    updatedBy: '',
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
    schemaVersion: 2,
    prompt: 'New instructions',
    documents: [],
    updatedAt: '2026-08-13T01:00:00.000Z',
  });
});

test('PUT stores uploaded documents alongside the prompt', async () => {
  const writes = [];
  const handler = createHandler({
    writeObject: async (key, buffer) => { writes.push({ key, buffer }); },
    now: () => '2026-08-13T01:00:00.000Z',
  });

  const response = await handler(event('PUT', {
    prompt: 'Use the attached papers',
    // `chars` is the client's display budget, not part of the stored record.
    documents: [
      { name: 'a.pdf', text: 'Alpha.', chars: 6 },
      { name: 'b.pdf', text: 'Beta.', chars: 5 },
    ],
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(writes[0].buffer.toString('utf-8')), {
    schemaVersion: 2,
    prompt: 'Use the attached papers',
    documents: [
      { name: 'a.pdf', text: 'Alpha.' },
      { name: 'b.pdf', text: 'Beta.' },
    ],
    updatedAt: '2026-08-13T01:00:00.000Z',
  });
});

test('PUT without documents publishes an empty set rather than preserving the old one', async () => {
  // A lecturer who removes every PDF and deploys must see them gone on the
  // lecture site. Preserving them silently would be the same class of bug as
  // silently dropping them.
  const writes = [];
  const handler = createHandler({
    writeObject: async (key, buffer) => { writes.push({ key, buffer }); },
    now: () => '2026-08-13T01:00:00.000Z',
  });

  await handler(event('PUT', { prompt: 'No papers now' }));

  assert.deepEqual(JSON.parse(writes[0].buffer.toString('utf-8')).documents, []);
});

test('PUT drops malformed document entries', async () => {
  const writes = [];
  const handler = createHandler({
    writeObject: async (key, buffer) => { writes.push({ key, buffer }); },
    now: () => '2026-08-13T01:00:00.000Z',
  });

  await handler(event('PUT', {
    prompt: 'Instructions',
    documents: [{ name: 'ok.pdf', text: 'fine' }, { name: 'no-text.pdf' }, null, 'nope'],
  }));

  assert.deepEqual(
    JSON.parse(writes[0].buffer.toString('utf-8')).documents,
    [{ name: 'ok.pdf', text: 'fine' }],
  );
});

test('PUT rejects too many or oversized documents', async () => {
  const handler = createHandler({
    writeObject: async () => { throw new Error('should not write'); },
  });

  const tooMany = Array.from({ length: MAX_DOCUMENTS + 1 }, (_, i) => ({
    name: `${i}.pdf`, text: 'x',
  }));
  assert.equal(
    (await handler(event('PUT', { prompt: 'p', documents: tooMany }))).statusCode,
    413,
  );

  const tooBig = [{ name: 'big.pdf', text: 'x'.repeat(MAX_DOCUMENTS_CHARS + 1) }];
  assert.equal(
    (await handler(event('PUT', { prompt: 'p', documents: tooBig }))).statusCode,
    413,
  );
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
