import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

import { buildAnalyticsObjectKey, handleAnalytics, sanitizeAnalyticsEvent } from './index.js';

const NOW = new Date('2026-08-03T04:05:06.000Z');

function event(overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: 'event-1',
    sessionId: 'session-1',
    occurredAt: NOW.toISOString(),
    eventName: 'video_seek',
    lessonSlug: 'gi-bleeding',
    videoTime: 120,
    properties: { fromSeconds: 240, toSeconds: 120, direction: 'backward' },
    ...overrides,
  };
}

test('sanitizeAnalyticsEvent keeps only the versioned analytics allowlist', () => {
  const sanitized = sanitizeAnalyticsEvent(event({
    userId: 'client-claimed-user',
    properties: { fromSeconds: 240, secret: 'do-not-store' },
  }), NOW);
  assert.equal(sanitized.userId, undefined);
  assert.deepEqual(sanitized.properties, { fromSeconds: 240 });
});
test('buildAnalyticsObjectKey partitions batches by UTC date and hour', () => {
  assert.equal(
    buildAnalyticsObjectKey(NOW, 'batch-1'),
    'analytics/events/date=2026-08-03/hour=04/batch-1.json.gz',
  );
});

test('handleAnalytics stores one compressed batch under the verified subject', async () => {
  let uploaded;
  const response = await handleAnalytics({
    body: JSON.stringify({ schemaVersion: 1, events: [event()] }),
  }, {
    identity: { oid: 'verified-oid', synthetic: false },
    now: () => NOW,
    createBatchId: () => 'batch-1',
    upload: async (key, body, contentType) => { uploaded = { key, body, contentType }; },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(uploaded.key, 'analytics/events/date=2026-08-03/hour=04/batch-1.json.gz');
  const stored = JSON.parse(gunzipSync(uploaded.body).toString('utf8'));
  assert.deepEqual(stored.subject, { type: 'entra', oid: 'verified-oid' });
  assert.equal(stored.events.length, 1);
});

test('handleAnalytics rejects a client-unknown event type', async () => {
  const response = await handleAnalytics({
    body: JSON.stringify({ schemaVersion: 1, events: [event({ eventName: 'email_captured' })] }),
  }, {
    identity: { oid: 'verified-oid', synthetic: false },
    now: () => NOW,
    upload: async () => assert.fail('must not upload'),
  });
  assert.equal(response.statusCode, 400);
});

test('handleAnalytics refuses an unverified caller before writing', async () => {
  const response = await handleAnalytics({
    body: JSON.stringify({ schemaVersion: 1, events: [event()] }),
  }, { upload: async () => assert.fail('must not upload') });
  assert.equal(response.statusCode, 401);
});
