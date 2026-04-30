import test from 'node:test';
import assert from 'node:assert/strict';
import { findRoute, createFunctionUrlEvent } from './localServer.js';
import { handler } from './index.js';

test('local server routes REST API paths to Lambda handlers', () => {
  const route = findRoute('POST', '/api/inference/generate');

  assert.equal(route.name, 'InferenceFunction');
  assert.equal(route.lambdaPath, '/api/inference/generate');
});

test('local server routes GPU instance idle checks to the instance handler', () => {
  const route = findRoute('POST', '/api/instance/idle-check');

  assert.equal(route.name, 'InstanceFunction');
  assert.equal(route.lambdaPath, '/api/instance/idle-check');
});

test('local server builds Function URL style events', async () => {
  const request = new Request('http://localhost:3000/api/ref-audio?filePath=audio%2Fref.wav', {
    method: 'GET',
    headers: { Origin: 'http://localhost:5173' },
  });
  const event = await createFunctionUrlEvent(request, '/api/ref-audio');

  assert.equal(event.rawPath, '/api/ref-audio');
  assert.equal(event.requestContext.http.method, 'GET');
  assert.deepEqual(event.queryStringParameters, { filePath: 'audio/ref.wav' });
  assert.equal(event.headers.origin, 'http://localhost:5173');
});

test('root Lambda handler dispatches Function URL style events', async () => {
  const response = await handler({
    version: '2.0',
    rawPath: '/api/config',
    requestContext: { http: { method: 'GET', path: '/api/config' } },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    storageMode: 's3',
    inferenceMode: 'remote',
  });
});
