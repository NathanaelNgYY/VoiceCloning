import { gunzipSync } from 'node:zlib';

import { getObject, listObjects } from '../shared/s3.js';

const MAX_EVENT_BATCHES = 250;
const MAX_EVENTS = 500;

function parseBatch(buffer) {
  try {
    return JSON.parse(gunzipSync(buffer).toString('utf8'));
  } catch {
    return null;
  }
}

async function readBatches(objects, oid, get, maxEvents = MAX_EVENTS) {
  const events = [];
  for (let index = 0; index < objects.length && events.length < maxEvents; index += 25) {
    const batch = objects.slice(index, index + 25);
    const records = await Promise.all(batch.map(async (object) => parseBatch(await get(object.key))));
    for (const record of records) {
      if (record?.subject?.oid !== oid) continue;
      for (const event of record.events || []) {
        events.push({ ...event, receivedAt: record.receivedAt, batchId: record.batchId });
      }
    }
  }
  return events;
}

export function createAnalyticsEventRepository({ list = listObjects, get = getObject } = {}) {
  async function getUserEvents(oid) {
    const userPrefix = `analytics/users/${oid}/`;
    const objects = await list(userPrefix);
    const newest = [...objects]
      .sort((left, right) => new Date(right.lastModified || 0) - new Date(left.lastModified || 0))
      .slice(0, MAX_EVENT_BATCHES);
    const events = await readBatches(newest, oid, get, MAX_EVENTS);
    events.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
    return {
      events: events.slice(0, MAX_EVENTS),
      truncated: objects.length > MAX_EVENT_BATCHES || events.length > MAX_EVENTS,
      storage: 'per-user-lake',
    };
  }

  return { getUserEvents };
}
