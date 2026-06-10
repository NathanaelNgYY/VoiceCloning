import test from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from './index.js';

function createEvent({ method = 'GET', path = '/api/voice-profile/configs/demo-v1', body } = {}) {
  return {
    requestContext: { http: { method } },
    rawPath: path,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {},
  };
}

test('voice profile configs lists saved configs for one person ordered by rank', async () => {
  const objects = [
    { key: 'voice-profile-configs/demo-v1/config-b.json', lastModified: new Date('2026-06-10T02:00:00Z') },
    { key: 'voice-profile-configs/demo-v1/config-a.json', lastModified: new Date('2026-06-10T01:00:00Z') },
  ];
  const stored = {
    'voice-profile-configs/demo-v1/config-a.json': { configId: 'config-a', rank: 2, configName: 'A' },
    'voice-profile-configs/demo-v1/config-b.json': { configId: 'config-b', rank: 1, configName: 'B' },
  };
  const handler = createHandler({
    listObjects: async (prefix) => {
      assert.equal(prefix, 'voice-profile-configs/demo-v1/');
      return objects;
    },
    readObject: async (key) => Buffer.from(JSON.stringify(stored[key]), 'utf-8'),
  });

  const response = await handler(createEvent());

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    configs: [
      { configId: 'config-b', rank: 1, configName: 'B', key: 'voice-profile-configs/demo-v1/config-b.json', updatedAt: '2026-06-10T02:00:00.000Z' },
      { configId: 'config-a', rank: 2, configName: 'A', key: 'voice-profile-configs/demo-v1/config-a.json', updatedAt: '2026-06-10T01:00:00.000Z' },
    ],
  });
});

test('voice profile configs saves a config with training, inference, reference, and sample metadata', async () => {
  const writes = [];
  const handler = createHandler({
    writeObject: async (key, payload, contentType) => {
      writes.push({ key, body: JSON.parse(payload.toString('utf-8')), contentType });
    },
    now: () => '2026-06-10T03:00:00.000Z',
  });

  const response = await handler(createEvent({
    method: 'PUT',
    path: '/api/voice-profile/configs/demo-v1/config-a',
    body: {
      configName: 'Warm ref',
      rank: 2,
      selected: true,
      trainingMetadata: { engineVersion: 'v2ProPlus', batchSize: 2 },
      inferenceMetadata: { speed_factor: 1, top_k: 5 },
      referenceMetadata: { primary: { path: 'training/datasets/demo/ref.wav', score: 114 }, aux: [] },
      sample: { text: 'This is a short comparison sample.', generatedAt: '2026-06-10T02:59:00.000Z' },
    },
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).config, writes[0].body);
  assert.deepEqual(writes, [{
    key: 'voice-profile-configs/demo-v1/config-a.json',
    contentType: 'application/json',
    body: {
      schemaVersion: 1,
      voiceProfileId: 'demo-v1',
      configId: 'config-a',
      configName: 'Warm ref',
      rank: 2,
      selected: true,
      trainingMetadata: { engineVersion: 'v2ProPlus', batchSize: 2 },
      inferenceMetadata: { speed_factor: 1, top_k: 5 },
      referenceMetadata: { primary: { path: 'training/datasets/demo/ref.wav', score: 114 }, aux: [] },
      sample: { text: 'This is a short comparison sample.', generatedAt: '2026-06-10T02:59:00.000Z' },
      updatedAt: '2026-06-10T03:00:00.000Z',
    },
  }]);
});

test('voice profile configs deletes one config', async () => {
  const deleted = [];
  const handler = createHandler({
    deleteObject: async (key) => deleted.push(key),
  });

  const response = await handler(createEvent({
    method: 'DELETE',
    path: '/api/voice-profile/configs/demo-v1/config-a',
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { deleted: true, configId: 'config-a' });
  assert.deepEqual(deleted, ['voice-profile-configs/demo-v1/config-a.json']);
});

test('voice profile configs can delete with POST for CloudFront method compatibility', async () => {
  const deleted = [];
  const handler = createHandler({
    deleteObject: async (key) => deleted.push(key),
  });

  const response = await handler(createEvent({
    method: 'POST',
    path: '/api/voice-profile/configs/demo-v1/config-a',
    body: { delete: true },
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { deleted: true, configId: 'config-a' });
  assert.deepEqual(deleted, ['voice-profile-configs/demo-v1/config-a.json']);
});
