import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCorsOriginOption } from './corsOrigin.js';

test('buildCorsOriginOption leaves wildcard CORS as wildcard', () => {
  assert.equal(buildCorsOriginOption('*'), '*');
});

test('buildCorsOriginOption converts comma-separated CloudFront origins to an array', () => {
  assert.deepEqual(
    buildCorsOriginOption('https://training.example.com, https://live-fast.example.com'),
    ['https://training.example.com', 'https://live-fast.example.com'],
  );
});
