// The only place the AWS SDK is imported. Kept apart from transcriptStore.js so
// the item shape and key layout stay testable without credentials or a table.
//
// The client is created lazily: the gateway must start normally on a host with
// no AWS configuration at all, which is the case for every local dev run.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

/**
 * @param {{ tableName: string, region: string }} options
 * @returns {(item: object) => Promise<unknown>} a putItem for createTranscriptStore
 */
export function createDynamoPutItem({ tableName, region }) {
  if (!tableName) throw new Error('createDynamoPutItem requires a tableName.');
  if (!region) throw new Error('createDynamoPutItem requires a region.');

  let docClient = null;

  return async function putItem(item) {
    if (!docClient) {
      // Credentials resolve from the instance profile on EC2; nothing is read
      // from the gateway's own config.
      docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    }

    return docClient.send(new PutCommand({ TableName: tableName, Item: item }));
  };
}
