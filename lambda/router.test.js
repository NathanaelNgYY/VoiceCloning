import test from 'node:test';
import assert from 'node:assert/strict';

import { findRoute, getRouteHandler } from './router.js';
import { handler as liveHandler } from './live/index.js';

test('router eagerly prepares the latency-sensitive Live handler', async () => {
  const route = findRoute('POST', '/api/live/tts-sentence');

  assert.equal(await getRouteHandler(route), liveHandler);
});

test('router resolves anonymous lesson analytics ingest', () => {
  const route = findRoute('POST', '/api/analytics/events');
  assert.equal(route.name, 'AnalyticsFunction');
  assert.equal(route.modulePath, './analytics/index.js');
});

test('router resolves voice profile activation and active-summary routes', () => {
  assert.deepEqual(
    findRoute('POST', '/api/voice-profile/activate'),
    {
      name: 'VoiceProfileFunction',
      methods: ['GET', 'POST'],
      pattern: /^\/api\/voice-profile\/(?:activate|active|internal\/[^/]+)\/?$/u,
      modulePath: './voice-profile/index.js',
      lambdaPath: '/api/voice-profile/activate',
    },
  );

  assert.deepEqual(
    findRoute('GET', '/api/voice-profile/active'),
    {
      name: 'VoiceProfileFunction',
      methods: ['GET', 'POST'],
      pattern: /^\/api\/voice-profile\/(?:activate|active|internal\/[^/]+)\/?$/u,
      modulePath: './voice-profile/index.js',
      lambdaPath: '/api/voice-profile/active',
    },
  );

  assert.deepEqual(
    findRoute('GET', '/api/voice-profile/internal/michael-tan-v1'),
    {
      name: 'VoiceProfileFunction',
      methods: ['GET', 'POST'],
      pattern: /^\/api\/voice-profile\/(?:activate|active|internal\/[^/]+)\/?$/u,
      modulePath: './voice-profile/index.js',
      lambdaPath: '/api/voice-profile/internal/michael-tan-v1',
    },
  );
});

test('router resolves shared training library routes', () => {
  assert.deepEqual(
    findRoute('GET', '/api/training-library'),
    {
      name: 'TrainingLibraryFunction',
      methods: ['GET', 'POST', 'DELETE'],
      pattern: /^\/api\/training-library(?:\/(?:snapshot|presign|confirm|[^/]+(?:\/(?:replace-presign|replace-confirm))?))?\/?$/u,
      modulePath: './training-library/index.js',
      lambdaPath: '/api/training-library',
    },
  );

  assert.deepEqual(
    findRoute('POST', '/api/training-library/snapshot'),
    {
      name: 'TrainingLibraryFunction',
      methods: ['GET', 'POST', 'DELETE'],
      pattern: /^\/api\/training-library(?:\/(?:snapshot|presign|confirm|[^/]+(?:\/(?:replace-presign|replace-confirm))?))?\/?$/u,
      modulePath: './training-library/index.js',
      lambdaPath: '/api/training-library/snapshot',
    },
  );

  assert.deepEqual(
    findRoute('DELETE', '/api/training-library/lib-123'),
    {
      name: 'TrainingLibraryFunction',
      methods: ['GET', 'POST', 'DELETE'],
      pattern: /^\/api\/training-library(?:\/(?:snapshot|presign|confirm|[^/]+(?:\/(?:replace-presign|replace-confirm))?))?\/?$/u,
      modulePath: './training-library/index.js',
      lambdaPath: '/api/training-library/lib-123',
    },
  );
});

test('router resolves training metadata route', () => {
  assert.deepEqual(
    findRoute('GET', '/api/train/metadata/demo'),
    {
      name: 'TrainingFunction',
      methods: ['GET', 'POST'],
      pattern: /^\/api\/train(?:\/(?:stop|current|metadata\/[^/]+))?\/?$/u,
      modulePath: './training/index.js',
      lambdaPath: '/api/train/metadata/demo',
    },
  );
});

test('router resolves generated inference chunk route', () => {
  assert.deepEqual(
    findRoute('GET', '/api/inference/chunk/abc-123/2'),
    {
      name: 'InferenceFunction',
      methods: ['GET', 'POST'],
      pattern: /^\/api\/inference(?:\/(?:generate|regenerate-chunk|restore-chunk|insert-chunk|delete-chunk|scan-oov|result\/[A-Za-z0-9-]+|chunk\/[A-Za-z0-9-]+\/\d+|chunk-preview\/[A-Za-z0-9-]+\/\d+|chunk-version\/[A-Za-z0-9-]+\/\d+\/[A-Za-z0-9-]+|cancel|current|status|start|stop))?\/?$/u,
      modulePath: './inference/index.js',
      lambdaPath: '/api/inference/chunk/abc-123/2',
    },
  );
});

test('router resolves normalized chunk previews and targeted regeneration', () => {
  assert.equal(findRoute('GET', '/api/inference/chunk-preview/abc-123/2')?.name, 'InferenceFunction');
  assert.equal(findRoute('POST', '/api/inference/regenerate-chunk')?.name, 'InferenceFunction');
  assert.equal(findRoute('POST', '/api/inference/restore-chunk')?.name, 'InferenceFunction');
  assert.equal(findRoute('GET', '/api/inference/chunk-version/abc-123/2/version-456')?.name, 'InferenceFunction');
  assert.equal(findRoute('POST', '/api/inference/delete-chunk')?.name, 'InferenceFunction');
  assert.equal(findRoute('POST', '/api/inference/insert-chunk')?.name, 'InferenceFunction');
});

test('router resolves per-person voice profile config routes', () => {
  assert.deepEqual(
    findRoute('GET', '/api/voice-profile/configs/michael-tan-v1'),
    {
      name: 'VoiceProfileConfigsFunction',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      pattern: /^\/api\/voice-profile\/configs\/[^/]+(?:\/[^/]+)?\/?$/u,
      modulePath: './voice-profile-configs/index.js',
      lambdaPath: '/api/voice-profile/configs/michael-tan-v1',
    },
  );

  assert.deepEqual(
    findRoute('PUT', '/api/voice-profile/configs/michael-tan-v1/warm-ref'),
    {
      name: 'VoiceProfileConfigsFunction',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      pattern: /^\/api\/voice-profile\/configs\/[^/]+(?:\/[^/]+)?\/?$/u,
      modulePath: './voice-profile-configs/index.js',
      lambdaPath: '/api/voice-profile/configs/michael-tan-v1/warm-ref',
    },
  );

  assert.deepEqual(
    findRoute('DELETE', '/api/voice-profile/configs/michael-tan-v1/warm-ref'),
    {
      name: 'VoiceProfileConfigsFunction',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      pattern: /^\/api\/voice-profile\/configs\/[^/]+(?:\/[^/]+)?\/?$/u,
      modulePath: './voice-profile-configs/index.js',
      lambdaPath: '/api/voice-profile/configs/michael-tan-v1/warm-ref',
    },
  );
});
