import test from 'node:test';
import assert from 'node:assert/strict';
import { findRoute, createApiGatewayEvent } from './localServer.js';

test('local server routes REST API paths to Lambda handlers', () => {
  const route = findRoute('POST', '/api/inference/generate');

  assert.equal(route.name, 'InferenceFunction');
  assert.equal(route.lambdaPath, '/api/inference/generate');
});

test('local server builds API Gateway v2 style events', async () => {
  const request = new Request('http://localhost:3000/api/ref-audio?filePath=audio%2Fref.wav', {
    method: 'GET',
    headers: { Origin: 'http://localhost:5173' },
  });
  const event = await createApiGatewayEvent(request, '/api/ref-audio');

  assert.equal(event.rawPath, '/api/ref-audio');
  assert.equal(event.requestContext.http.method, 'GET');
  assert.deepEqual(event.queryStringParameters, { filePath: 'audio/ref.wav' });
  assert.equal(event.headers.origin, 'http://localhost:5173');
});
