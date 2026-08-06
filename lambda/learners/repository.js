import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

export function createLearnerRepository({
  tableName = process.env.LEARNER_TABLE_NAME || '',
  region = process.env.LEARNER_TABLE_REGION || 'ap-northeast-2',
  client = null,
} = {}) {
  if (!tableName) return null;
  const documentClient = client || DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  async function getSummary(oid, lessonSlug) {
    const response = await documentClient.send(new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${oid}`, SK: `LESSON#${lessonSlug}#SUMMARY` },
    }));
    return response.Item || null;
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
    return {
      profile: items.find((item) => item.SK === 'PROFILE') || null,
      lessons: items.filter((item) => /^LESSON#.+#SUMMARY$/u.test(item.SK || '')),
    };
  }

  return { getSummary, listUsers, getUserLearningState };
}
