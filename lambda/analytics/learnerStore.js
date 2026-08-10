import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { buildLearnerSummary, evidenceFromEvent, statusForEvidence } from './concepts.js';

const SECONDS_PER_DAY = 86_400;
export const EVIDENCE_WINDOW_DAYS = 30;
export const CONCEPT_SCORE_CAP = 3;
export const SIGNAL_EVENT_CAPS = Object.freeze({
  rewatched_segment: 2,
  repeated_question: 2,
});

function asSignalArray(value) {
  if (value instanceof Set) return [...value];
  return Array.isArray(value) ? value : [];
}

function validEvidenceEvent(value, cutoffMs) {
  const occurredAtMs = Date.parse(value?.occurredAt);
  return value
    && SIGNAL_EVENT_CAPS[value.signal]
    && Number.isFinite(Number(value.weight))
    && Number(value.weight) > 0
    && Number.isFinite(occurredAtMs)
    && occurredAtMs >= cutoffMs;
}

export function buildRollingEvidenceState(item = {}, incomingEvents = [], at = new Date()) {
  const cutoffMs = at.getTime() - EVIDENCE_WINDOW_DAYS * SECONDS_PER_DAY * 1000;
  const combined = [...(Array.isArray(item.evidenceEvents) ? item.evidenceEvents : []), ...incomingEvents]
    .filter((event) => validEvidenceEvent(event, cutoffMs))
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  const counts = new Map();
  const seen = new Set();
  const evidenceEvents = [];
  for (const event of combined) {
    const identity = event.eventId || `${event.signal}:${event.occurredAt}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const count = counts.get(event.signal) || 0;
    if (count >= SIGNAL_EVENT_CAPS[event.signal]) continue;
    counts.set(event.signal, count + 1);
    evidenceEvents.push(event);
  }

  const legacyUpdatedAtMs = Date.parse(item.updatedAt);
  const implicitLegacy = !Array.isArray(item.evidenceEvents) && Number(item.evidenceScore) > 0;
  const legacyExpiresAt = implicitLegacy
    ? new Date(legacyUpdatedAtMs + EVIDENCE_WINDOW_DAYS * SECONDS_PER_DAY * 1000).toISOString()
    : item.legacyEvidenceExpiresAt;
  const legacyActive = Number.isFinite(Date.parse(legacyExpiresAt)) && Date.parse(legacyExpiresAt) >= at.getTime();
  const legacyScore = legacyActive
    ? Math.min(CONCEPT_SCORE_CAP, Number(implicitLegacy ? item.evidenceScore : item.legacyEvidenceScore) || 0)
    : 0;
  const legacyCount = legacyActive
    ? Math.min(
      Object.values(SIGNAL_EVENT_CAPS).reduce((sum, value) => sum + value, 0),
      Number(implicitLegacy ? item.evidenceCount : item.legacyEvidenceCount) || 0,
    )
    : 0;
  const eventScore = evidenceEvents.reduce((sum, event) => sum + Number(event.weight), 0);
  const evidenceCountCap = Object.values(SIGNAL_EVENT_CAPS).reduce((sum, value) => sum + value, 0);
  const signals = new Set(evidenceEvents.map((event) => event.signal));
  const legacySignals = legacyActive
    ? asSignalArray(implicitLegacy ? item.signals : item.legacyEvidenceSignals)
    : [];
  legacySignals.forEach((signal) => signals.add(signal));

  return {
    evidenceEvents,
    evidenceScore: Math.min(CONCEPT_SCORE_CAP, Math.round((legacyScore + eventScore) * 100) / 100),
    evidenceCount: Math.min(evidenceCountCap, legacyCount + evidenceEvents.length),
    signals,
    windowStartedAt: new Date(cutoffMs).toISOString(),
    legacyEvidenceScore: legacyScore,
    legacyEvidenceCount: legacyCount,
    legacyEvidenceSignals: legacySignals,
    legacyEvidenceExpiresAt: legacyActive ? legacyExpiresAt : null,
  };
}

// Stored evidence is only pruned when a concept is written, so any read must
// re-derive the rolling window before the score is used or summarised.
export function currentConceptState(item, at) {
  const state = buildRollingEvidenceState(item, [], at);
  return {
    ...item,
    ...state,
    signals: state.signals,
    status: statusForEvidence(state.evidenceScore),
  };
}

export function createLearnerStore({
  tableName = process.env.LEARNER_TABLE_NAME || '',
  region = process.env.LEARNER_TABLE_REGION || 'ap-northeast-2',
  ttlDays = Number.parseInt(process.env.LEARNER_TTL_DAYS || '90', 10),
  client = null,
  now = () => new Date(),
} = {}) {
  if (!tableName) return null;
  const documentClient = client || DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  function ttl(at) {
    return ttlDays > 0
      ? Math.floor(at.getTime() / 1000) + ttlDays * SECONDS_PER_DAY
      : undefined;
  }

  async function recordBatch(identity, events) {
    if (!identity?.oid || identity.synthetic) return { recorded: 0, summaries: [] };
    const grouped = new Map();
    for (const event of events) {
      const evidence = evidenceFromEvent(event);
      if (!evidence) continue;
      const key = `${event.lessonSlug}:${evidence.concept.id}`;
      const current = grouped.get(key) || {
        lessonSlug: event.lessonSlug,
        concept: evidence.concept,
        events: [],
      };
      current.events.push({
        eventId: String(event.eventId || ''),
        signal: evidence.signal,
        weight: evidence.weight,
        occurredAt: event.occurredAt || now().toISOString(),
      });
      grouped.set(key, current);
    }

    const at = now();
    const expiresAt = ttl(at);
    for (const entry of grouped.values()) {
      const key = {
        PK: `USER#${identity.oid}`,
        SK: `LESSON#${entry.lessonSlug}#CONCEPT#${entry.concept.id}`,
      };
      let written = false;
      for (let attempt = 0; attempt < 4 && !written; attempt += 1) {
        const existing = await documentClient.send(new GetCommand({ TableName: tableName, Key: key }));
        const state = buildRollingEvidenceState(existing.Item, entry.events, at);
        const expectedRevision = Number(existing.Item?.evidenceRevision) || 0;
        const values = {
        ':score': state.evidenceScore,
        ':count': state.evidenceCount,
        ':lesson': entry.lessonSlug,
        ':conceptId': entry.concept.id,
        ':conceptLabel': entry.concept.label,
        ':updatedAt': at.toISOString(),
        ':signals': state.signals,
        ':events': state.evidenceEvents,
        ':windowStartedAt': state.windowStartedAt,
        ':legacyScore': state.legacyEvidenceScore,
        ':legacyCount': state.legacyEvidenceCount,
        ':legacySignals': state.legacyEvidenceSignals,
        ':legacyExpiresAt': state.legacyEvidenceExpiresAt,
          ':nextRevision': expectedRevision + 1,
        };
        if (expectedRevision > 0) values[':expectedRevision'] = expectedRevision;
        let update = 'SET evidenceScore = :score, evidenceCount = :count, signals = :signals, evidenceEvents = :events, windowStartedAt = :windowStartedAt, legacyEvidenceScore = :legacyScore, legacyEvidenceCount = :legacyCount, legacyEvidenceSignals = :legacySignals, legacyEvidenceExpiresAt = :legacyExpiresAt, evidenceRevision = :nextRevision, lessonSlug = :lesson, conceptId = :conceptId, conceptLabel = :conceptLabel, updatedAt = :updatedAt';
        if (expiresAt !== undefined) {
          values[':ttl'] = expiresAt;
          update += ', #ttl = :ttl';
        }
        try {
          await documentClient.send(new UpdateCommand({
            TableName: tableName,
            Key: key,
            UpdateExpression: update,
            ConditionExpression: expectedRevision === 0
              ? 'attribute_not_exists(evidenceRevision)'
              : 'evidenceRevision = :expectedRevision',
            ExpressionAttributeNames: expiresAt === undefined ? undefined : { '#ttl': 'ttl' },
            ExpressionAttributeValues: values,
          }));
          written = true;
        } catch (error) {
          if (error?.name !== 'ConditionalCheckFailedException' || attempt === 3) throw error;
        }
      }
    }

    const lessons = [...new Set([...grouped.values()].map((entry) => entry.lessonSlug))];
    const summaries = [];
    for (const lessonSlug of lessons) {
      const response = await documentClient.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${identity.oid}`,
          ':prefix': `LESSON#${lessonSlug}#CONCEPT#`,
        },
      }));
      const states = (response.Items || []).map((item) => currentConceptState(item, at));
      const item = {
        PK: `USER#${identity.oid}`,
        SK: `LESSON#${lessonSlug}#SUMMARY`,
        lessonSlug,
        ...buildLearnerSummary(states),
        source: 'rules',
        concepts: states.map((state) => ({
          conceptId: state.conceptId,
          conceptLabel: state.conceptLabel,
          status: state.status,
          evidenceScore: state.evidenceScore,
          evidenceCount: state.evidenceCount,
          signals: [...(state.signals || [])],
        })),
        updatedAt: at.toISOString(),
        ...(expiresAt === undefined ? {} : { ttl: expiresAt }),
      };
      await documentClient.send(new PutCommand({ TableName: tableName, Item: item }));
      summaries.push(item);
    }

    return { recorded: grouped.size, summaries };
  }

  return { recordBatch };
}
