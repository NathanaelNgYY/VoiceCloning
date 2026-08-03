import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';

import { err, ok, parseJsonBody } from '../shared/cors.js';
import { uploadBuffer } from '../shared/s3.js';

export const MAX_ANALYTICS_EVENTS = 50;
export const ANALYTICS_SCHEMA_VERSION = 1;

const EVENT_NAMES = new Set([
  'lesson_session_started',
  'lesson_session_ended',
  'lesson_tab_viewed',
  'lesson_navigation',
  'video_play',
  'video_pause',
  'video_seek',
  'video_ended',
  'transcript_scrolled',
]);

const PROPERTY_KEYS = new Set([
  'activeTab',
  'pauseDurationSeconds',
  'fromSeconds',
  'toSeconds',
  'deltaSeconds',
  'direction',
  'source',
]);

function safeString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}
function safeNumber(value, { min = -28800, max = 28800 } = {}) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? Math.round(number * 1000) / 1000
    : null;
}

function sanitizeProperties(properties) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {};
  const result = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!PROPERTY_KEYS.has(key)) continue;
    if (typeof value === 'number') {
      const number = safeNumber(value);
      if (number !== null) result[key] = number;
    } else if (typeof value === 'boolean') {
      result[key] = value;
    } else if (typeof value === 'string') {
      result[key] = safeString(value, 40);
    }
  }
  return result;
}

export function sanitizeAnalyticsEvent(value, receivedAt = new Date()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const eventName = safeString(value.eventName, 60);
  const sessionId = safeString(value.sessionId, 80);
  const eventId = safeString(value.eventId, 80);
  const lessonSlug = safeString(value.lessonSlug, 80);
  const occurredAtMs = Date.parse(value.occurredAt);
  const maxClockDriftMs = 24 * 60 * 60 * 1000;
  if (
    Number(value.schemaVersion) !== ANALYTICS_SCHEMA_VERSION
    || !EVENT_NAMES.has(eventName)
    || !sessionId
    || !eventId
    || !lessonSlug
    || !Number.isFinite(occurredAtMs)
    || Math.abs(receivedAt.getTime() - occurredAtMs) > maxClockDriftMs
  ) return null;

  const videoTime = safeNumber(value.videoTime, { min: 0, max: 8 * 60 * 60 });
  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    eventId,
    sessionId,
    occurredAt: new Date(occurredAtMs).toISOString(),
    eventName,
    lessonSlug,
    ...(videoTime === null ? {} : { videoTime }),
    properties: sanitizeProperties(value.properties),
  };
}

export function buildAnalyticsObjectKey(receivedAt, batchId) {
  const iso = receivedAt.toISOString();
  return `analytics/events/date=${iso.slice(0, 10)}/hour=${iso.slice(11, 13)}/${batchId}.json.gz`;
}

export async function handleAnalytics(event, {
  upload = uploadBuffer,
  now = () => new Date(),
  createBatchId = randomUUID,
} = {}) {
  let body;
  try {
    body = parseJsonBody(event);
  } catch {
    return err(400, 'Analytics body must be valid JSON.', event);
  }

  if (Number(body?.schemaVersion) !== ANALYTICS_SCHEMA_VERSION || !Array.isArray(body?.events)) {
    return err(400, 'Analytics payload has an unsupported schema.', event);
  }
  if (body.events.length === 0 || body.events.length > MAX_ANALYTICS_EVENTS) {
    return err(400, `Analytics payload must contain 1-${MAX_ANALYTICS_EVENTS} events.`, event);
  }

  const receivedAt = now();
  const events = body.events.map((item) => sanitizeAnalyticsEvent(item, receivedAt));
  if (events.some((item) => item === null)) {
    return err(400, 'Analytics payload contains an invalid event.', event);
  }

  const batchId = createBatchId();
  const record = {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    batchId,
    receivedAt: receivedAt.toISOString(),
    // Deliberately anonymous. When SSO is enforced, the backend can add a
    // validated subject here; it must never trust a user ID sent by the browser.
    subject: { type: 'anonymous' },
    events,
  };
  await upload(
    buildAnalyticsObjectKey(receivedAt, batchId),
    gzipSync(Buffer.from(JSON.stringify(record) + '\n', 'utf8')),
    'application/x-ndjson',
  );
  return ok({ accepted: events.length, batchId }, {}, event);
}

export async function handler(event) {
  try {
    return await handleAnalytics(event);
  } catch (error) {
    console.error('Analytics ingest failed', error?.name || 'Error');
    return err(500, 'Analytics events could not be stored.', event);
  }
}
