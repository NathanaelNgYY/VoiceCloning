import test from 'node:test';
import assert from 'node:assert/strict';
import { corsHeaders, preflight } from './cors.js';

test('CORS allows CloudFront OAC payload hash header', () => {
  assert.match(
    corsHeaders['Access-Control-Allow-Headers'],
    /x-amz-content-sha256/u,
  );
});

test('preflight returns the same allowed request headers', () => {
  const response = preflight();

  assert.equal(response.statusCode, 200);
  assert.match(
    response.headers['Access-Control-Allow-Headers'],
    /x-amz-content-sha256/u,
  );
});
