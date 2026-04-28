import test from 'node:test';
import assert from 'node:assert/strict';
import { findRoute, createApiGatewayEvent, resolveLocalCorsOrigin } from './localServer.js';

test('local server routes REST API paths to Lambda handlers', () => {
  const route = findRoute('POST', '/api/inference/generate');

  assert.equal(route.name, 'InferenceFunction');
  assert.equal(route.lambdaPath, '/api/inference/generate');
});

test('local server routes instance control paths to the instance Lambda handler', () => {
  const statusRoute = findRoute('GET', '/api/instance/status');
  const startRoute = findRoute('POST', '/api/instance/start');

  assert.equal(statusRoute.name, 'InstanceFunction');
  assert.equal(startRoute.name, 'InstanceFunction');
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

test('local server reflects loopback CORS origins for 127.0.0.1 browser testing', () => {
  assert.equal(
    resolveLocalCorsOrigin('http://127.0.0.1:5173', 'http://localhost:5173'),
    'http://127.0.0.1:5173'
  );
  assert.equal(
    resolveLocalCorsOrigin('https://voice.example.com', 'https://cloudfront.example.com'),
    'https://cloudfront.example.com'
  );
});
