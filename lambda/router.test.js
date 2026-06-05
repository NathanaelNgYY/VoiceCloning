import test from 'node:test';
import assert from 'node:assert/strict';

import { findRoute } from './router.js';

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
