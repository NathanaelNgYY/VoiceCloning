import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { evidenceFromEvent, statusForEvidence } from './concepts.js';
import { createSummaryGenerator } from './summaryGenerator.js';

const SECONDS_PER_DAY = 86_400;

export function createLearnerStore({
  tableName = process.env.LEARNER_TABLE_NAME || '',
  region = process.env.LEARNER_TABLE_REGION || 'ap-northeast-2',
  ttlDays = Number.parseInt(process.env.LEARNER_TTL_DAYS || '90', 10),
  client = null,
  now = () => new Date(),
  generateSummary = createSummaryGenerator(),
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
        score: 0,
        signals: new Set(),
      };
      current.score += evidence.weight;
      current.signals.add(evidence.signal);
      grouped.set(key, current);
    }

    const at = now();
    const expiresAt = ttl(at);
    for (const entry of grouped.values()) {
      const values = {
        ':score': entry.score,
        ':one': 1,
        ':lesson': entry.lessonSlug,
        ':conceptId': entry.concept.id,
        ':conceptLabel': entry.concept.label,
        ':updatedAt': at.toISOString(),
        ':signals': new Set(entry.signals),
      };
      let update = 'ADD evidenceScore :score, evidenceCount :one, signals :signals SET lessonSlug = :lesson, conceptId = :conceptId, conceptLabel = :conceptLabel, updatedAt = :updatedAt';
      if (expiresAt !== undefined) {
        values[':ttl'] = expiresAt;
        update += ', #ttl = :ttl';
      }
      await documentClient.send(new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: `USER#${identity.oid}`,
          SK: `LESSON#${entry.lessonSlug}#CONCEPT#${entry.concept.id}`,
        },
        UpdateExpression: update,
        ExpressionAttributeNames: expiresAt === undefined ? undefined : { '#ttl': 'ttl' },
        ExpressionAttributeValues: values,
      }));
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
      const states = (response.Items || []).map((item) => ({
        ...item,
        status: statusForEvidence(item.evidenceScore),
      }));
      const summary = await generateSummary(states);
      const item = {
        PK: `USER#${identity.oid}`,
        SK: `LESSON#${lessonSlug}#SUMMARY`,
        lessonSlug,
        ...summary,
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
