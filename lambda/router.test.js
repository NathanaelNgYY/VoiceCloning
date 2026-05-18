import test from 'node:test';
import assert from 'node:assert/strict';

import { findRoute } from './router.js';

test('router resolves voice profile activation and active-summary routes', () => {
  assert.deepEqual(
    findRoute('POST', '/api/voice-profile/activate'),
    {
      name: 'VoiceProfileFunction',
      methods: ['GET', 'POST'],
      pattern: /^\/api\/voice-profile\/(?:activate|active)\/?$/u,
      modulePath: './voice-profile/index.js',
      lambdaPath: '/api/voice-profile/activate',
    },
  );

  assert.deepEqual(
    findRoute('GET', '/api/voice-profile/active'),
    {
      name: 'VoiceProfileFunction',
      methods: ['GET', 'POST'],
      pattern: /^\/api\/voice-profile\/(?:activate|active)\/?$/u,
      modulePath: './voice-profile/index.js',
      lambdaPath: '/api/voice-profile/active',
    },
  );
});
