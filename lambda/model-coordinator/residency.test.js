import assert from 'node:assert/strict';
import test from 'node:test';
import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { coordinationKey, lockResidency, unlockResidency } from './index.js';

function recorder() {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command);
      return {};
    },
  };
}

test('event lock stores the configured profile minimum and expiry', async () => {
  const documentClient = recorder();
  const result = await lockResidency({
    voiceProfileId: 'deanvoice-v1',
    minimumWorkers: 2,
    expiresAt: 2_000_000,
  }, 1_000_000, { documentClient, coordinatorTable: 'test-table' });

  assert.equal(result.statusCode, 200);
  assert.ok(documentClient.calls[0] instanceof PutCommand);
  assert.deepEqual(documentClient.calls[0].input.Item, {
    entity: 'RESIDENCY_LOCK',
    id: coordinationKey('LOCK', 'profile:deanvoice-v1'),
    coordinatorScope: 'vcs-staging-gpu-inference',
    voiceProfileId: 'deanvoice-v1',
    modelKey: undefined,
    minimumWorkers: 2,
    requestedAt: 1_000_000,
    expiresAt: 2_000_000,
  });
});

test('event lock rejects missing identity and unsafe minimums without writing', async () => {
  const documentClient = recorder();
  assert.equal((await lockResidency({ minimumWorkers: 1 }, 0, { documentClient })).statusCode, 400);
  assert.equal((await lockResidency({
    voiceProfileId: 'deanvoice-v1',
    minimumWorkers: 0,
  }, 0, { documentClient })).statusCode, 400);
  assert.equal(documentClient.calls.length, 0);
});

test('event unlock deletes only the requested profile lock', async () => {
  const documentClient = recorder();
  const result = await unlockResidency({ voiceProfileId: 'deanvoice-v1' }, {
    documentClient,
    coordinatorTable: 'test-table',
  });

  assert.equal(result.statusCode, 200);
  assert.ok(documentClient.calls[0] instanceof DeleteCommand);
  assert.deepEqual(documentClient.calls[0].input, {
    TableName: 'test-table',
    Key: { id: coordinationKey('LOCK', 'profile:deanvoice-v1') },
  });
});
