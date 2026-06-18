import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from './index.js';

function event(method, path, body = null, query = null) {
  return {
    rawPath: path,
    queryStringParameters: query,
    requestContext: { http: { method } },
    body: body ? JSON.stringify(body) : '',
  };
}

test('pronunciation dictionary saves reviewed English entries by category', async () => {
  const objects = new Map();
  const handler = createHandler({
    readObject: async (key) => {
      if (!objects.has(key)) {
        const error = new Error('missing');
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }
      return objects.get(key);
    },
    writeObject: async (key, buffer) => objects.set(key, buffer),
    now: () => '2026-06-18T00:00:00.000Z',
  });

  const save = await handler(event('POST', '/api/pronunciation-dictionary', {
    word: 'hydrolysis',
    category: 'biology',
    arpabet: 'HH AY0 D R AA1 L AH0 S IH0 S',
    readable: 'high-DRAW-luh-sis',
  }));
  assert.equal(save.statusCode, 200);

  const list = await handler(event('GET', '/api/pronunciation-dictionary', null, { category: 'biology' }));
  const body = JSON.parse(list.body);
  assert.equal(body.entries[0].word, 'hydrolysis');
  assert.equal(body.entries[0].category, 'biology');
});

test('pronunciation lookup returns free Datamuse ARPAbet suggestions', async () => {
  const handler = createHandler({
    fetchImpl: async () => ({
      ok: true,
      json: async () => [{ word: 'enzyme', tags: ['pron:EH1 N Z AY0 M'], score: 100 }],
    }),
  });

  const response = await handler(event('POST', '/api/pronunciation-dictionary/lookup', { word: 'enzyme' }));
  const body = JSON.parse(response.body);
  assert.equal(body.suggestions[0].arpabet, 'EH1 N Z AY0 M');
});
