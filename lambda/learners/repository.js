import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { buildLearnerSummary, statusForEvidence } from '../analytics/concepts.js';
import { buildRollingEvidenceState } from '../analytics/learnerStore.js';

export function createLearnerRepository({
  tableName = process.env.LEARNER_TABLE_NAME || '',
  region = process.env.LEARNER_TABLE_REGION || 'ap-northeast-2',
  ttlDays = Number.parseInt(process.env.LEARNER_TTL_DAYS || '90', 10),
  client = null,
  now = () => new Date(),
} = {}) {
  if (!tableName) return null;
  const documentClient = client || DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  function currentConcept(item, at) {
    const state = buildRollingEvidenceState(item, [], at);
    return {
      ...item,
      ...state,
      signals: state.signals,
      status: statusForEvidence(state.evidenceScore),
    };
  }

  function summaryFromStates(oid, lessonSlug, states, at) {
    if (states.length === 0) return null;
    const summary = buildLearnerSummary(states);
    return {
      PK: `USER#${oid}`,
      SK: `LESSON#${lessonSlug}#SUMMARY`,
      lessonSlug,
      ...summary,
      source: 'rules',
      concepts: states.map((state) => ({
        conceptId: state.conceptId,
        conceptLabel: state.conceptLabel,
        status: state.status,
        evidenceScore: state.evidenceScore,
        evidenceCount: state.evidenceCount,
        signals: [...state.signals],
      })),
      updatedAt: at.toISOString(),
    };
  }

  async function getSummary(oid, lessonSlug) {
    const response = await documentClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${oid}`,
        ':prefix': `LESSON#${lessonSlug}#CONCEPT#`,
      },
    }));
    const at = now();
    const states = (response.Items || []).map((item) => currentConcept(item, at));
    return summaryFromStates(oid, lessonSlug, states, at);
  }

  async function listUsers({ limit = 100 } = {}) {
    const response = await documentClient.send(new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :users',
      ExpressionAttributeValues: { ':users': 'USERS' },
      ScanIndexForward: false,
      Limit: Math.max(1, Math.min(100, Number(limit) || 100)),
    }));
    return (response.Items || []).map((item) => ({
      oid: String(item.PK || '').replace(/^USER#/u, ''),
      displayName: item.displayName || '',
      email: item.email || '',
      lastSeenAt: item.lastSeenAt || '',
    }));
  }

  async function getUserLearningState(oid) {
    const response = await documentClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `USER#${oid}` },
    }));
    const items = response.Items || [];
    const at = now();
    const conceptsByLesson = new Map();
    for (const item of items) {
      const match = /^LESSON#(.+)#CONCEPT#[^#]+$/u.exec(item.SK || '');
      if (!match) continue;
      const states = conceptsByLesson.get(match[1]) || [];
      states.push(currentConcept(item, at));
      conceptsByLesson.set(match[1], states);
    }
    return {
      profile: items.find((item) => item.SK === 'PROFILE') || null,
      lessons: [...conceptsByLesson.entries()]
        .map(([lessonSlug, states]) => summaryFromStates(oid, lessonSlug, states, at)),
    };
  }

  async function resetConcept(oid, lessonSlug, conceptId) {
    const pk = `USER#${oid}`;
    await documentClient.send(new DeleteCommand({
      TableName: tableName,
      Key: { PK: pk, SK: `LESSON#${lessonSlug}#CONCEPT#${conceptId}` },
    }));
    const response = await documentClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':prefix': `LESSON#${lessonSlug}#CONCEPT#`,
      },
    }));
    const at = now();
    const states = (response.Items || []).map((item) => currentConcept(item, at));
    const summaryKey = { PK: pk, SK: `LESSON#${lessonSlug}#SUMMARY` };
    if (states.length === 0) {
      await documentClient.send(new DeleteCommand({ TableName: tableName, Key: summaryKey }));
      return { reset: true, summary: null };
    }
    const summary = summaryFromStates(oid, lessonSlug, states, at);
    const item = {
      ...summary,
      ...(ttlDays > 0 ? { ttl: Math.floor(at.getTime() / 1000) + ttlDays * 86_400 } : {}),
    };
    await documentClient.send(new PutCommand({ TableName: tableName, Item: item }));
    return { reset: true, summary: item };
  }

  return { getSummary, listUsers, getUserLearningState, resetConcept };
}
