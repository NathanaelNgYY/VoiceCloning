import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import test from 'node:test';

import { createAnalyticsEventRepository } from './eventRepository.js';

function compressed(oid, eventId, occurredAt = '2026-08-10T10:00:00.000Z') {
  return gzipSync(Buffer.from(JSON.stringify({
    batchId: `batch-${eventId}`,
    receivedAt: occurredAt,
    subject: { type: 'entra', oid },
    events: [{ eventId, eventName: 'video_play', lessonSlug: 'gi-bleeding', occurredAt }],
  })));
}

test('reads the user-specific S3 event index and returns newest actions first', async () => {
  const values = new Map([
    ['analytics/users/user-1/a.json.gz', compressed('user-1', 'older', '2026-08-09T10:00:00.000Z')],
    ['analytics/users/user-1/b.json.gz', compressed('user-1', 'newer', '2026-08-10T10:00:00.000Z')],
  ]);
  const repository = createAnalyticsEventRepository({
    list: async () => [...values.keys()].map((key) => ({ key, lastModified: new Date() })),
    get: async (key) => values.get(key),
  });
  const result = await repository.getUserEvents('user-1');
  assert.equal(result.storage, 'per-user-lake');
  assert.deepEqual(result.events.map((event) => event.eventId), ['newer', 'older']);
});

test('does not scan the global lake when a user has no indexed events', async () => {
  const prefixes = [];
  const repository = createAnalyticsEventRepository({
    list: async (prefix) => { prefixes.push(prefix); return []; },
    get: async () => assert.fail('must not read an object'),
  });
  const result = await repository.getUserEvents('user-1');
  assert.deepEqual(prefixes, ['analytics/users/user-1/']);
  assert.equal(result.storage, 'per-user-lake');
  assert.deepEqual(result.events, []);
});
