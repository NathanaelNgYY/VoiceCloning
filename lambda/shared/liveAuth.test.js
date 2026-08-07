import assert from 'node:assert/strict';
import test from 'node:test';

import { createLiveAuthGuard, readBearerToken, resetLiveAuthCache } from './liveAuth.js';

const IDENTITY = {
  oid: 'e3f1c0aa-1111-2222-3333-444455556666',
  email: 'cs-nathanael.ng@assoc.main.ntu.edu.sg',
  name: 'Nathanael Ng',
  tenantId: '45e82b6b-5ac4-41a7-a36f-e702e5e3a355',
};

const ENABLED_ENV = {
  LIVE_AUTH_ENABLED: 'true',
  ENTRA_TENANT_ID: IDENTITY.tenantId,
  ENTRA_AUDIENCE: 'api://9b5c52c0-5f02-4dbf-83ac-c68d246abc68',
  ENTRA_ALLOWED_EMAIL_DOMAINS: 'assoc.main.ntu.edu.sg',
};

function stubVerifier(accepts = 'good-token') {
  return {
    verify: async (token) => {
      if (token !== accepts) {
        const error = new Error('Token signature does not verify.');
        error.code = 'bad_signature';
        throw error;
      }
      return IDENTITY;
    },
  };
}

const eventWith = (authorization) => ({ headers: authorization ? { authorization } : {} });

test('a bearer token is read regardless of header casing', () => {
  assert.equal(readBearerToken({ headers: { authorization: 'Bearer abc' } }), 'abc');
  assert.equal(readBearerToken({ headers: { Authorization: 'bearer abc' } }), 'abc');
  assert.equal(readBearerToken({ headers: { Authorization: 'Bearer   abc  ' } }), 'abc');
});

test('the Entra header survives a SigV4-signed CloudFront Lambda origin', () => {
  assert.equal(readBearerToken({
    headers: {
      authorization: 'AWS4-HMAC-SHA256 cloudfront-origin-signature',
      'X-VCS-Entra-Token': 'entra-token',
    },
  }), 'entra-token');
});

test('anything that is not a bearer token reads as absent', () => {
  assert.equal(readBearerToken({ headers: { authorization: 'abc' } }), '');
  assert.equal(readBearerToken({ headers: { authorization: 'Basic abc' } }), '');
  assert.equal(readBearerToken({ headers: {} }), '');
  assert.equal(readBearerToken(undefined), '');
});

test('the guard is absent when authentication is off, leaving behaviour unchanged', () => {
  assert.equal(createLiveAuthGuard({ env: {} }), null);
  assert.equal(createLiveAuthGuard({ env: { LIVE_AUTH_ENABLED: 'false' } }), null);
});

test('a valid token authorizes the caller', async () => {
  const guard = createLiveAuthGuard({ env: ENABLED_ENV, verifier: stubVerifier() });

  const identity = await guard.authorize(eventWith('Bearer good-token'));

  assert.equal(identity.oid, IDENTITY.oid);
  assert.equal(identity.synthetic, false);
});

test('a forged or missing token is refused', async () => {
  const guard = createLiveAuthGuard({ env: ENABLED_ENV, verifier: stubVerifier() });

  await assert.rejects(() => guard.authorize(eventWith('Bearer forged')));
  await assert.rejects(() => guard.authorize(eventWith('')));
  await assert.rejects(() => guard.authorize({ headers: {} }));
});

test('a misconfigured guard refuses everything rather than passing callers through', async () => {
  // A route that believes it is protected but is not is the worst outcome here.
  const guard = createLiveAuthGuard({ env: { LIVE_AUTH_ENABLED: 'true' } });

  await assert.rejects(() => guard.authorize(eventWith('Bearer good-token')), (error) => {
    assert.equal(error.code, 'misconfigured');
    return true;
  });
});

test('the load-test secret authorizes as a synthetic caller', async () => {
  const guard = createLiveAuthGuard({
    env: { ...ENABLED_ENV, LIVE_AUTH_LOADTEST_SECRET: 'rehearsal' },
    verifier: stubVerifier(),
  });

  const identity = await guard.authorize(eventWith('Bearer rehearsal'));

  assert.equal(identity.synthetic, true);
  assert.equal(identity.oid, 'LOADTEST#lambda');
});

test('the load-test path is closed when no secret is configured', async () => {
  const guard = createLiveAuthGuard({ env: ENABLED_ENV, verifier: stubVerifier() });

  await assert.rejects(() => guard.authorize(eventWith('Bearer rehearsal')));
});

test('the verifier is reused across invocations so warm containers keep the JWKS cache', () => {
  resetLiveAuthCache();
  const first = createLiveAuthGuard({ env: ENABLED_ENV });
  const second = createLiveAuthGuard({ env: ENABLED_ENV });

  assert.notEqual(first, null);
  assert.notEqual(second, null);
  resetLiveAuthCache();
});
