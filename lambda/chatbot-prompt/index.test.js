import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHandler,
  categoryFromKey,
  categoryKey,
  isValidCategory,
  DEFAULT_CATEGORY,
  SYSTEM_PROMPT_KEY,
  MAX_PROMPT_CHARS,
  MAX_DOCUMENTS_CHARS,
  MAX_DOCUMENTS,
} from './index.js';

const DEFAULT_KEY = categoryKey(DEFAULT_CATEGORY);

function event(method, body, { category, path = '/api/chatbot/system-prompt' } = {}) {
  return {
    requestContext: { http: { method } },
    rawPath: path,
    queryStringParameters: category === undefined ? undefined : { category },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function missingKeyError() {
  const error = new Error('NoSuchKey');
  error.name = 'NoSuchKey';
  return error;
}

/** A reader over a fixed key→record map, missing-object erroring like S3 does. */
function readerFor(objects) {
  return async (key) => {
    if (!(key in objects)) throw missingKeyError();
    return Buffer.from(JSON.stringify(objects[key]));
  };
}

test('GET returns an empty prompt when nothing is deployed yet', async () => {
  const handler = createHandler({
    readObject: async () => { throw missingKeyError(); },
  });

  const response = await handler(event('GET'));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    category: DEFAULT_CATEGORY, prompt: '', documents: [], updatedAt: '', updatedBy: '',
  });
});

test('GET returns the deployed prompt and documents', async () => {
  const handler = createHandler({
    readObject: readerFor({
      [DEFAULT_KEY]: {
        schemaVersion: 3,
        category: DEFAULT_CATEGORY,
        prompt: 'Deployed instructions',
        documents: [{ name: 'paper.pdf', text: 'Findings.' }],
        updatedAt: '2026-08-13T00:00:00.000Z',
        updatedBy: 'editor@example.com',
      },
    }),
  });

  const response = await handler(event('GET'));

  assert.deepEqual(JSON.parse(response.body), {
    category: DEFAULT_CATEGORY,
    prompt: 'Deployed instructions',
    documents: [{ name: 'paper.pdf', text: 'Findings.' }],
    updatedAt: '2026-08-13T00:00:00.000Z',
    updatedBy: 'editor@example.com',
  });
});

test('GET reads a schemaVersion 1 record as a prompt with no documents', async () => {
  const handler = createHandler({
    readObject: readerFor({
      [DEFAULT_KEY]: {
        schemaVersion: 1,
        prompt: 'Older deploy',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    }),
  });

  const response = await handler(event('GET'));

  assert.deepEqual(JSON.parse(response.body), {
    category: DEFAULT_CATEGORY,
    prompt: 'Older deploy',
    documents: [],
    updatedAt: '2026-08-01T00:00:00.000Z',
    updatedBy: '',
  });
});

test('GET reads the category asked for', async () => {
  const handler = createHandler({
    readObject: readerFor({
      [categoryKey('gi-bleeding')]: { schemaVersion: 3, prompt: 'GI instructions', documents: [] },
      [categoryKey('cardiology')]: { schemaVersion: 3, prompt: 'Cardiology instructions', documents: [] },
    }),
  });

  const gi = JSON.parse((await handler(event('GET', undefined, { category: 'gi-bleeding' }))).body);
  const cardio = JSON.parse((await handler(event('GET', undefined, { category: 'cardiology' }))).body);

  assert.equal(gi.category, 'gi-bleeding');
  assert.equal(gi.prompt, 'GI instructions');
  assert.equal(cardio.prompt, 'Cardiology instructions');
});

test('GET falls back to the pre-category object for a category never deployed to', async () => {
  // Every lecture asks for its own category for the first time during the
  // rollout. Answering those with an empty prompt would drop every student back
  // to the bundled default — a silent downgrade of a working assistant.
  const handler = createHandler({
    readObject: readerFor({
      [SYSTEM_PROMPT_KEY]: {
        schemaVersion: 2,
        prompt: 'The one prompt everyone shared',
        documents: [{ name: 'shared.pdf', text: 'Shared.' }],
        updatedAt: '2026-08-17T02:51:36.898Z',
      },
    }),
  });

  const response = JSON.parse((await handler(event('GET', undefined, { category: 'neurology' }))).body);

  assert.equal(response.category, 'neurology');
  assert.equal(response.prompt, 'The one prompt everyone shared');
  assert.deepEqual(response.documents, [{ name: 'shared.pdf', text: 'Shared.' }]);
});

test("GET prefers a category's own object over the pre-category fallback", async () => {
  const handler = createHandler({
    readObject: readerFor({
      [categoryKey('gi-bleeding')]: { schemaVersion: 3, prompt: 'Its own prompt', documents: [] },
      [SYSTEM_PROMPT_KEY]: { schemaVersion: 2, prompt: 'The old shared prompt', documents: [] },
    }),
  });

  const response = JSON.parse((await handler(event('GET', undefined, { category: 'gi-bleeding' }))).body);

  assert.equal(response.prompt, 'Its own prompt');
});

test('a category id that could escape the prefix is rejected', async () => {
  // The id lands in an S3 key, so this is a path-safety boundary, not just a
  // naming rule.
  const handler = createHandler({
    readObject: async () => { throw new Error('should not read'); },
    writeObject: async () => { throw new Error('should not write'); },
  });

  for (const category of ['../secrets', 'a/b', 'dot.dot', '-leading', 'under_score', 'x'.repeat(65)]) {
    assert.equal(
      (await handler(event('GET', undefined, { category }))).statusCode,
      400,
      `GET should reject ${JSON.stringify(category)}`,
    );
    assert.equal(
      (await handler(event('PUT', { prompt: 'p' }, { category }))).statusCode,
      400,
      `PUT should reject ${JSON.stringify(category)}`,
    );
  }

  assert.ok(isValidCategory('gi-bleeding'));
  assert.ok(!isValidCategory('gi_bleeding'));
});

test('a blank category means the default, and case is not a second category', async () => {
  // "GI-Bleeding" typed into the editor must not deploy a lecture the site can
  // never route to — slugs are lowercase.
  const writes = [];
  const handler = createHandler({
    writeObject: async (key) => { writes.push(key); },
    now: () => '2026-08-19T01:00:00.000Z',
  });

  await handler(event('PUT', { prompt: 'p' }, { category: '   ' }));
  await handler(event('PUT', { prompt: 'p' }, { category: 'GI-Bleeding' }));

  assert.deepEqual(writes, [DEFAULT_KEY, categoryKey('gi-bleeding')]);
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
  assert.equal(writes[0].key, DEFAULT_KEY);
  assert.equal(writes[0].contentType, 'application/json');
  assert.deepEqual(JSON.parse(writes[0].buffer.toString('utf-8')), {
    schemaVersion: 3,
    category: DEFAULT_CATEGORY,
    prompt: 'New instructions',
    documents: [],
    updatedAt: '2026-08-13T01:00:00.000Z',
  });
});

test('PUT writes each category to its own key', async () => {
  // Two lecturers deploying at once must not clobber each other. Different
  // categories are different objects, so there is nothing to race over.
  const writes = [];
  const handler = createHandler({
    writeObject: async (key, buffer) => { writes.push({ key, buffer }); },
    now: () => '2026-08-19T01:00:00.000Z',
  });

  await handler(event('PUT', { prompt: 'GI' }, { category: 'gi-bleeding' }));
  await handler(event('PUT', { prompt: 'Cardio' }, { category: 'cardiology' }));

  assert.deepEqual(writes.map((w) => w.key), [
    categoryKey('gi-bleeding'),
    categoryKey('cardiology'),
  ]);
  assert.equal(JSON.parse(writes[0].buffer.toString('utf-8')).category, 'gi-bleeding');
});

test('PUT never overwrites the pre-category object', async () => {
  // It stays as the fallback for frontends deployed before categories existed.
  const writes = [];
  const handler = createHandler({
    writeObject: async (key) => { writes.push(key); },
    now: () => '2026-08-19T01:00:00.000Z',
  });

  await handler(event('PUT', { prompt: 'p' }));
  await handler(event('PUT', { prompt: 'p' }, { category: 'gi-bleeding' }));

  assert.ok(!writes.includes(SYSTEM_PROMPT_KEY));
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
    schemaVersion: 3,
    category: DEFAULT_CATEGORY,
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

test('PUT accepts documents with no typed instructions', async () => {
  // A lecturer who only wants the papers answered from should not have to invent
  // instructions first; the frontends supply their neutral built-in prompt.
  const writes = [];
  const handler = createHandler({
    writeObject: async (key, buffer) => { writes.push({ key, buffer }); },
    now: () => '2026-08-17T02:00:00.000Z',
  });

  const response = await handler(event('PUT', {
    prompt: '',
    documents: [{ name: 'paper.pdf', text: 'Written by A. Author and B. Author.' }],
  }));

  assert.equal(response.statusCode, 200);
  const record = JSON.parse(writes[0].buffer.toString('utf-8'));
  assert.equal(record.prompt, '');
  assert.deepEqual(record.documents, [
    { name: 'paper.pdf', text: 'Written by A. Author and B. Author.' },
  ]);
});

test('PUT rejects a deploy carrying neither half', async () => {
  const handler = createHandler({
    writeObject: async () => { throw new Error('should not write'); },
  });

  assert.equal((await handler(event('PUT', { prompt: '', documents: [] }))).statusCode, 400);
  // Malformed entries are dropped, so this is an empty deploy too.
  assert.equal(
    (await handler(event('PUT', { prompt: '  ', documents: [{ name: 'x.pdf' }] }))).statusCode,
    400,
  );
});

test('GET /categories lists what has been deployed', async () => {
  const handler = createHandler({
    listStoredObjects: async (prefix) => {
      assert.equal(prefix, 'chatbot-config/system-prompt/');
      return [
        { key: categoryKey('gi-bleeding'), lastModified: new Date('2026-08-18T01:13:12.000Z') },
        { key: categoryKey('cardiology'), lastModified: new Date('2026-08-19T00:00:00.000Z') },
        // Anything else that ends up under the prefix is not a category.
        { key: 'chatbot-config/system-prompt/notes.txt', lastModified: new Date() },
      ];
    },
  });

  const response = await handler(event('GET', undefined, {
    path: '/api/chatbot/system-prompt/categories',
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    categories: [
      { category: 'cardiology', updatedAt: '2026-08-19T00:00:00.000Z' },
      { category: 'gi-bleeding', updatedAt: '2026-08-18T01:13:12.000Z' },
    ],
  });
});

test('the pre-category object is not itself a category', () => {
  // It sits beside the prefix rather than inside it, so it can never appear in
  // the list as a lecture named "system-prompt".
  assert.equal(categoryFromKey(SYSTEM_PROMPT_KEY), '');
  assert.equal(categoryFromKey(categoryKey('gi-bleeding')), 'gi-bleeding');
});

test('unsupported methods are rejected', async () => {
  const handler = createHandler({});
  assert.equal((await handler(event('DELETE'))).statusCode, 405);
  assert.equal(
    (await handler(event('PUT', {}, { path: '/api/chatbot/system-prompt/categories' }))).statusCode,
    405,
  );
});
