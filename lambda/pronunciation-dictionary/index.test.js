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
    verifyPhonemes: true,
  }));
  assert.equal(save.statusCode, 200);

  const list = await handler(event('GET', '/api/pronunciation-dictionary', null, { category: 'biology' }));
  const body = JSON.parse(list.body);
  assert.equal(body.entries[0].word, 'hydrolysis');
  assert.equal(body.entries[0].category, 'biology');
  assert.equal(body.entries[0].verifyPhonemes, true);
});

test('pronunciation dictionary moves a saved word between categories without duplicates', async () => {
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

  await handler(event('POST', '/api/pronunciation-dictionary', {
    word: 'enzyme',
    category: 'biology',
    arpabet: 'EH1 N Z AY0 M',
  }));
  await handler(event('POST', '/api/pronunciation-dictionary', {
    word: 'enzyme',
    category: 'chemistry',
    arpabet: 'EH1 N Z AY2 M',
  }));

  const biology = JSON.parse((await handler(event(
    'GET', '/api/pronunciation-dictionary', null, { category: 'biology' },
  ))).body);
  const chemistry = JSON.parse((await handler(event(
    'GET', '/api/pronunciation-dictionary', null, { category: 'chemistry' },
  ))).body);
  assert.equal(biology.entries.length, 0);
  assert.equal(chemistry.entries.length, 1);
  assert.equal(chemistry.entries[0].arpabet, 'EH1 N Z AY2 M');
  assert.equal('readable' in chemistry.entries[0], false);
});

test('pronunciation dictionary rejects readable-only entries', async () => {
  const handler = createHandler();
  const response = await handler(event('POST', '/api/pronunciation-dictionary', {
    word: 'iron',
    category: 'chemistry',
    readable: 'eye urn',
  }));
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).error, /arpabet is required/u);
});

test('pronunciation dictionary hides legacy cross-category duplicates before cleanup', async () => {
  const objects = new Map([
    ['pronunciation-dictionary/english/general.json', Buffer.from(JSON.stringify({
      category: 'general',
      entries: [{ word: 'iron', category: 'general', arpabet: 'OLD', updatedAt: '2026-07-13T00:00:00.000Z' }],
    }))],
    ['pronunciation-dictionary/english/chemistry.json', Buffer.from(JSON.stringify({
      category: 'chemistry',
      entries: [{ word: 'iron', category: 'chemistry', arpabet: 'AY1 ER0 N', updatedAt: '2026-07-14T00:00:00.000Z' }],
    }))],
  ]);
  const handler = createHandler({
    readObject: async (key) => {
      if (objects.has(key)) return objects.get(key);
      const error = new Error('missing');
      error.$metadata = { httpStatusCode: 404 };
      throw error;
    },
  });

  const general = JSON.parse((await handler(event(
    'GET', '/api/pronunciation-dictionary', null, { category: 'general' },
  ))).body);
  const chemistry = JSON.parse((await handler(event(
    'GET', '/api/pronunciation-dictionary', null, { category: 'chemistry' },
  ))).body);
  assert.equal(general.entries.length, 0);
  assert.equal(chemistry.entries.length, 1);
  assert.equal(chemistry.entries[0].arpabet, 'AY1 ER0 N');
});

test('pronunciation dictionary deletes legacy duplicates from every category', async () => {
  const objects = new Map();
  objects.set('pronunciation-dictionary/english/general.json', Buffer.from(JSON.stringify({
    schemaVersion: 1,
    language: 'en',
    category: 'general',
    entries: [{ word: 'enzyme', category: 'general', arpabet: 'OLD' }],
  })));
  objects.set('pronunciation-dictionary/english/biology.json', Buffer.from(JSON.stringify({
    schemaVersion: 1,
    language: 'en',
    category: 'biology',
    entries: [{ word: 'enzyme', category: 'biology', arpabet: 'EH1 N Z AY0 M' }],
  })));
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

  const deleted = await handler(event('POST', '/api/pronunciation-dictionary', {
    action: 'delete',
    word: 'enzyme',
    category: 'biology',
  }));

  assert.equal(deleted.statusCode, 200);
  const body = JSON.parse(deleted.body);
  assert.equal(body.deleted, true);
  assert.equal(body.dictionary.entries.length, 0);
  const general = JSON.parse(objects.get('pronunciation-dictionary/english/general.json').toString('utf-8'));
  assert.equal(general.entries.length, 0);
});
