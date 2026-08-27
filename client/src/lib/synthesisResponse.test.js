import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isGpuOfflineResponse, synthesisResponseError } from './synthesisResponse.js';

const GPU_OFFLINE = 'GPU not started — press Start GPU to begin.';
const decode = (text, status) => synthesisResponseError(text, status, { gpuOfflineMessage: GPU_OFFLINE });

function capacityBody(code = 'MODEL_CAPACITY_STARTING') {
  return JSON.stringify({
    error: 'This lecture voice is preparing on a GPU. You can wait or use another lecture meanwhile.',
    code,
    retryAfterSeconds: 90,
    scaleStarted: true,
    voiceProfileId: 'cs-nathanael-ng',
  });
}

// The regression this guards: the coordinator answers "your voice model is still
// loading onto a GPU" with a 503, and isGpuOfflineResponse() matches every 503
// whatever the body says. Checking offline first told a user staring at a running
// GPU to press Start GPU — a button that does nothing for a loading model.
test('reads a capacity 503 as a loading model, not as a stopped GPU', () => {
  // Arrange / Act
  const err = decode(capacityBody(), 503);

  // Assert
  assert.equal(err.code, 'MODEL_CAPACITY_STARTING');
  assert.equal(err.status, 503);
  assert.equal(err.retryAfterSeconds, 90);
  assert.equal(err.scaleStarted, true);
  assert.equal(err.voiceProfileId, 'cs-nathanael-ng');
  assert.match(err.message, /still|preparing/i);
  assert.notEqual(err.message, GPU_OFFLINE);
});

test('keeps the fleet-at-limit code distinct from a stopped GPU', () => {
  const err = decode(capacityBody('MODEL_CAPACITY_LIMIT'), 503);

  assert.equal(err.code, 'MODEL_CAPACITY_LIMIT');
  assert.notEqual(err.message, GPU_OFFLINE);
});

test('defaults a capacity body that carries no message or retry hint', () => {
  const err = decode(JSON.stringify({ code: 'MODEL_CAPACITY_STARTING' }), 503);

  assert.equal(err.code, 'MODEL_CAPACITY_STARTING');
  assert.equal(err.retryAfterSeconds, 0);
  assert.equal(err.scaleStarted, false);
  assert.equal(err.voiceProfileId, '');
  assert.equal(err.message, 'This lecture voice is preparing.');
});

test('still reports a genuinely offline GPU in this build\u2019s wording', () => {
  const err = decode('<html><body><h1>503 Service Temporarily Unavailable</h1></body></html>', 503);

  assert.equal(err.code, 'GPU_OFFLINE');
  assert.equal(err.status, 503);
  assert.equal(err.message, GPU_OFFLINE);
});

// The gi kiosk shows no Start GPU button, so it words the same error differently.
test('uses whatever offline wording the caller injects', () => {
  const kiosk = 'The voice engine is still starting up — please try again in a moment.';
  const err = synthesisResponseError('', 504, { gpuOfflineMessage: kiosk });

  assert.equal(err.code, 'GPU_OFFLINE');
  assert.equal(err.status, 504);
  assert.equal(err.message, kiosk);
});

// A queue 503 from the worker itself (NO_FREE_SLOT, QUEUE_TIMEOUT,
// MODEL_REASSIGNING) has no capacity code, so it keeps the retryable GPU_OFFLINE
// classification the live path depends on.
test('leaves a worker queue 503 retryable as GPU_OFFLINE', () => {
  const err = decode(JSON.stringify({ error: 'Timed out waiting for an available GPU worker.', code: 'QUEUE_TIMEOUT' }), 503);

  assert.equal(err.code, 'GPU_OFFLINE');
});

test('surfaces a real client-side rejection unchanged', () => {
  const err = decode(JSON.stringify({ error: 'ref_audio_path is required' }), 400);

  assert.equal(err.status, 400);
  assert.equal(err.code, undefined);
  assert.equal(err.message, 'ref_audio_path is required');
});

test('falls back to the raw body, then to the status, when there is no JSON error', () => {
  assert.equal(decode('upstream exploded', 418).message, 'upstream exploded');
  assert.equal(decode('', 418).message, 'Request failed with status 418');
  assert.equal(decode(JSON.stringify({ detail: 'nope' }), 418).message, 'Request failed with status 418');
});

test('detects the gateway statuses and HTML bodies that mean the GPU is down', () => {
  assert.equal(isGpuOfflineResponse(502), true);
  assert.equal(isGpuOfflineResponse(503), true);
  assert.equal(isGpuOfflineResponse(504), true);
  assert.equal(isGpuOfflineResponse(200, 'Bad Gateway'), true);
  assert.equal(isGpuOfflineResponse(400, 'ref_audio_path is required'), false);
});

// Both synthesis routes decoding their own bodies is what let them drift apart in
// the first place, so pin the single decoder rather than the wording.
test('every synthesis route in api.js decodes through the shared decoder', () => {
  const apiSource = readFileSync(new URL('../services/api.js', import.meta.url), 'utf8');
  const decoders = apiSource.match(/throw synthesisError\(await res\.data\.text\(\), res\.status\)/gu) || [];

  assert.equal(decoders.length, 2, 'expected /inference and /live/tts-sentence to share one decoder');
  assert.doesNotMatch(apiSource, /MODEL_CAPACITY_/u, 'capacity handling belongs in lib/synthesisResponse.js only');
});
