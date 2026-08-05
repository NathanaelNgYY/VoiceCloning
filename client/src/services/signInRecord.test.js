import assert from 'node:assert/strict';
import test from 'node:test';

import { SIGN_IN_PATH, recordSignIn } from './signInRecord.js';

const URL_UNDER_TEST = `https://gateway.example${SIGN_IN_PATH}`;

function harness({
  isTokenModeEnabled = () => true,
  getToken = async () => 'a.b.c',
  response = { ok: true, status: 200 },
  fetchImpl,
} = {}) {
  const calls = [];
  const warnings = [];

  const run = () => recordSignIn({
    url: URL_UNDER_TEST,
    isTokenModeEnabled,
    getToken,
    fetchImpl: fetchImpl === undefined
      ? async (url, options) => {
        calls.push({ url, options });
        return response;
      }
      : fetchImpl,
    logger: { warn: (...args) => warnings.push(args) },
  });

  return { run, calls, warnings };
}

test('posts the token as a bearer header and reports success', async () => {
  const { run, calls } = harness();

  const result = await run();

  assert.deepEqual(result, { sent: true, ok: true, status: 200 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, URL_UNDER_TEST);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer a.b.c');
});

test('sends no body — the identity comes from the token alone', async () => {
  const { run, calls } = harness();

  await run();

  assert.equal(calls[0].options.body, undefined);
});

test('does nothing on a build that holds no token', async () => {
  const { run, calls } = harness({ isTokenModeEnabled: () => false });

  const result = await run();

  assert.deepEqual(result, { sent: false, reason: 'no_token_mode' });
  assert.deepEqual(calls, [], 'a request the gateway would reject is not worth making');
});

test('a failed token acquisition is swallowed, not thrown', async () => {
  const { run, calls, warnings } = harness({
    getToken: async () => { throw new Error('interaction_required'); },
  });

  const result = await run();

  assert.deepEqual(result, { sent: false, reason: 'token_failed' });
  assert.deepEqual(calls, []);
  assert.equal(warnings.length, 1);
});

test('an empty token is not sent', async () => {
  const { run, calls } = harness({ getToken: async () => '' });

  const result = await run();

  assert.deepEqual(result, { sent: false, reason: 'token_empty' });
  assert.deepEqual(calls, []);
});

test('a rejected request is reported, not thrown', async () => {
  const { run, warnings } = harness({ response: { ok: false, status: 401 } });

  const result = await run();

  assert.deepEqual(result, { sent: true, ok: false, status: 401 });
  assert.equal(warnings.length, 1);
});

test('a gateway that is down never surfaces to the student', async () => {
  const { run, warnings } = harness({
    fetchImpl: async () => { throw new Error('Failed to fetch'); },
  });

  const result = await run();

  assert.deepEqual(result, { sent: false, reason: 'network_failed' });
  assert.equal(warnings.length, 1);
});

test('an environment with no fetch degrades quietly', async () => {
  const { run } = harness({ fetchImpl: null });

  assert.deepEqual(await run(), { sent: false, reason: 'no_fetch' });
});

test('never rejects, whatever fails', async () => {
  // The caller uses `void reportSignIn()`, so a rejection would surface as an
  // unhandled promise rejection rather than anything catchable.
  const cases = [
    harness({ isTokenModeEnabled: () => { throw new Error('boom'); } }),
    harness({ getToken: async () => { throw new Error('boom'); } }),
    harness({ fetchImpl: async () => { throw new Error('boom'); } }),
    harness({ response: { ok: false, status: 500 } }),
  ];

  const results = await Promise.allSettled(cases.map(({ run }) => run()));

  for (const settled of results) {
    assert.equal(settled.status, 'fulfilled');
  }
  assert.equal(results[0].value.reason, 'token_mode_failed');
});
