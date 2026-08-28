import test from 'node:test';
import assert from 'node:assert/strict';

import {
  capacityWaitMessage,
  formatWaitEstimate,
  isCapacityWaitError,
  isRetryableSynthesisError,
  isTransientBackendError,
  sanitizeBackendError,
  synthesisRetryDelayMs,
} from './backendErrors.js';

function capacityErr(seconds = 360, code = 'MODEL_CAPACITY_STARTING') {
  const err = new Error('An idle GPU is switching to this lecture voice. Please wait before starting voice conversation.');
  err.code = code;
  err.status = 503;
  err.retryAfterSeconds = seconds;
  return err;
}

// The regression this guards: services/api.js rewrites every 502/503/504 body to
// GPU_OFFLINE_MESSAGE, so a predicate that reads the message text sees no "503"
// and the live reply gives up on the first clip against a still-warming GPU.
test('classifies a rewritten GPU-offline error as retryable despite its message', () => {
  // Arrange
  const err = new Error('GPU not started — press Start GPU to begin.');
  err.code = 'GPU_OFFLINE';
  err.status = 503;

  // Act / Assert
  assert.equal(isRetryableSynthesisError(err), true);
});

test('classifies the gi wording of the same error as retryable', () => {
  const err = new Error('The voice engine is still starting up — please try again in a moment.');
  err.code = 'GPU_OFFLINE';
  err.status = 504;

  assert.equal(isRetryableSynthesisError(err), true);
});

test('retries on a transient status even when the message says nothing useful', () => {
  const err = new Error('Request failed');
  err.status = 429;

  assert.equal(isRetryableSynthesisError(err), true);
});

test('still retries the busy/conflict messages the live path always retried', () => {
  assert.equal(isRetryableSynthesisError(new Error('Inference is already running')), true);
  assert.equal(isRetryableSynthesisError(new Error('GPU is busy')), true);
});

test('does not retry a genuine client-side rejection', () => {
  const err = new Error('ref_audio_path is required');
  err.status = 400;

  assert.equal(isRetryableSynthesisError(err), false);
});

test('does not hide a model-capacity start behind rapid synthesis retries', () => {
  const err = new Error('This lecture voice is preparing on a GPU.');
  err.code = 'MODEL_CAPACITY_STARTING';
  err.status = 503;
  assert.equal(isRetryableSynthesisError(err), false);
});

test('Dev capacity simulation is informational and is not retried', () => {
  const err = capacityErr(5, 'DEV_CAPACITY_SIMULATED');

  assert.equal(isCapacityWaitError(err), true);
  assert.equal(isRetryableSynthesisError(err), false);
});

test('does not retry a cancelled clip', () => {
  // 499 is the worker rejecting a barged-in reply — re-issuing it would resurrect
  // audio the user already talked over.
  const err = new Error('Reply was cancelled while waiting for the GPU');
  err.status = 499;

  assert.equal(isRetryableSynthesisError(err), false);
});

test('backs off harder for a warming GPU than for a busy one', () => {
  const warming = new Error('warming');
  warming.code = 'GPU_OFFLINE';
  const busy = new Error('GPU is busy');

  assert.equal(synthesisRetryDelayMs(warming, 0), 2000);
  assert.equal(synthesisRetryDelayMs(warming, 1), 4000);
  assert.equal(synthesisRetryDelayMs(busy, 0), 650);
  assert.equal(synthesisRetryDelayMs(busy, 1), 1300);
});

test('treats a response-less failure as a transient backend error', () => {
  assert.equal(isTransientBackendError(new Error('Network Error')), true);
  assert.equal(isTransientBackendError({ response: { status: 503 } }), true);
  assert.equal(isTransientBackendError({ response: { status: 400 } }), false);
});

test('blanks bare gateway text but keeps a real message', () => {
  assert.equal(sanitizeBackendError('<html><body>503 Service Temporarily Unavailable</body></html>'), '');
  assert.equal(sanitizeBackendError('No reference audio configured.'), 'No reference audio configured.');
  assert.equal(
    sanitizeBackendError('The voice engine is still starting up — please try again in a moment.'),
    'The voice engine is still starting up — please try again in a moment.',
  );
});

// A red banner reading "Voice reply failed" for a GPU that is merely switching
// voices tells the user something broke when nothing did.
test('separates a capacity wait from a genuine failure', () => {
  assert.equal(isCapacityWaitError(capacityErr()), true);
  assert.equal(isCapacityWaitError(capacityErr(30, 'MODEL_CAPACITY_LIMIT')), true);

  const offline = new Error('GPU not started');
  offline.code = 'GPU_OFFLINE';
  assert.equal(isCapacityWaitError(offline), false);
  assert.equal(isCapacityWaitError(new Error('nope')), false);
});

test('reads the wait estimate in whichever unit is legible', () => {
  assert.equal(formatWaitEstimate(30), 'about 30 seconds');
  assert.equal(formatWaitEstimate(89), 'about 89 seconds');
  assert.equal(formatWaitEstimate(360), 'about 6 minutes');
  assert.equal(formatWaitEstimate(600), 'about 10 minutes');
});

test('never promises a zero-length wait', () => {
  assert.equal(formatWaitEstimate(0), '');
  assert.equal(formatWaitEstimate(undefined), '');
  assert.equal(formatWaitEstimate(-5), '');
  // Rounding must not turn a real wait into "about 0 minutes".
  assert.equal(formatWaitEstimate(95), 'about 2 minutes');
});

// The estimate comes from the coordinator (MODEL_BOOT_ESTIMATE_SECONDS), so the
// promise tracks the fleet's config rather than a number frozen into the bundle.
test('quotes the coordinator’s own estimate back to the user', () => {
  const message = capacityWaitMessage(capacityErr(360));

  assert.match(message, /switching to this lecture voice/);
  assert.match(message, /about 6 minutes/);
  assert.match(message, /try again then/);
});

test('tracks a re-configured estimate without a client change', () => {
  assert.match(capacityWaitMessage(capacityErr(600)), /about 10 minutes/);
});

test('drops the timing clause when the backend sends no estimate', () => {
  const message = capacityWaitMessage(capacityErr(0));

  assert.match(message, /switching to this lecture voice/);
  assert.doesNotMatch(message, /usually takes/);
});

test('returns nothing for an error that is not a capacity wait', () => {
  assert.equal(capacityWaitMessage(new Error('ref_audio_path is required')), '');
});
