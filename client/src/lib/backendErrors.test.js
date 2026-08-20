import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isRetryableSynthesisError,
  isTransientBackendError,
  sanitizeBackendError,
  synthesisRetryDelayMs,
} from './backendErrors.js';

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
