import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_CLOSE_CODES,
  closeCodeForError,
  createLiveChatAuthenticator,
  parseAuthFrame,
} from './liveChatAuth.js';

const IDENTITY = {
  oid: 'e3f1c0aa-1111-2222-3333-444455556666',
  email: 'cs-nathanael.ng@assoc.main.ntu.edu.sg',
  name: 'Nathanael Ng',
  tenantId: '45e82b6b-5ac4-41a7-a36f-e702e5e3a355',
};

function stubVerifier({ accepts = 'good-token' } = {}) {
  const calls = [];
  return {
    calls,
    verify: async (token) => {
      calls.push(token);
      if (token !== accepts) {
        const error = new Error('Token signature does not verify.');
        error.code = 'bad_signature';
        throw error;
      }
      return IDENTITY;
    },
  };
}

function frame(value) {
  return Buffer.from(JSON.stringify(value));
}

test('a session.auth frame is parsed and anything else is not', () => {
  assert.deepEqual(parseAuthFrame(frame({ type: 'session.auth', token: 'abc' })), {
    token: 'abc',
    loadTestSecret: '',
    loadTestUser: 0,
  });

  assert.equal(parseAuthFrame(frame({ type: 'session.init', systemPrompt: 'hi' })), null);
  assert.equal(parseAuthFrame(frame({ type: 'audio.chunk', audio: 'AAAA' })), null);
  assert.equal(parseAuthFrame(Buffer.from('not json')), null);
  assert.equal(parseAuthFrame(frame(['session.auth'])), null);
});

test('non-string token fields do not survive parsing', () => {
  // A client sending { token: { toString: ... } } must not reach the verifier
  // with an object that stringifies into something surprising.
  const parsed = parseAuthFrame(frame({ type: 'session.auth', token: { evil: true } }));

  assert.equal(parsed.token, '');
});

test('a valid token yields a non-synthetic identity', async () => {
  const verifier = stubVerifier();
  const auth = createLiveChatAuthenticator({ verifier });

  const identity = await auth.authenticate({ token: 'good-token' });

  assert.deepEqual(identity, { ...IDENTITY, synthetic: false });
  assert.deepEqual(verifier.calls, ['good-token']);
});

test('an invalid token is rejected with the verifier error intact', async () => {
  const auth = createLiveChatAuthenticator({ verifier: stubVerifier() });

  await assert.rejects(() => auth.authenticate({ token: 'forged' }), (error) => {
    assert.equal(error.code, 'bad_signature');
    return true;
  });
});

test('a missing frame is rejected rather than treated as anonymous', async () => {
  const auth = createLiveChatAuthenticator({ verifier: stubVerifier() });

  await assert.rejects(() => auth.authenticate(null), (error) => {
    assert.equal(error.code, 'missing');
    return true;
  });
});

test('the load-test secret yields a synthetic, identifiable identity', async () => {
  const auth = createLiveChatAuthenticator({
    verifier: stubVerifier(),
    loadTestSecret: 'rehearsal-secret',
  });

  const identity = await auth.authenticate({
    loadTestSecret: 'rehearsal-secret',
    loadTestUser: 7,
  });

  assert.equal(identity.oid, 'LOADTEST#7');
  assert.equal(identity.synthetic, true);
  assert.equal(identity.email, '');
});

test('the bypass is closed when no secret is configured', async () => {
  // The bypass must never be implied by enabling authentication.
  const auth = createLiveChatAuthenticator({ verifier: stubVerifier() });

  await assert.rejects(
    () => auth.authenticate({ loadTestSecret: 'anything', loadTestUser: 1 }),
    (error) => {
      assert.equal(error.code, 'forbidden');
      return true;
    },
  );
});

test('a wrong load-test secret is rejected', async () => {
  const auth = createLiveChatAuthenticator({
    verifier: stubVerifier(),
    loadTestSecret: 'rehearsal-secret',
  });

  await assert.rejects(
    () => auth.authenticate({ loadTestSecret: 'rehearsal-secre', loadTestUser: 1 }),
    (error) => {
      assert.equal(error.code, 'forbidden');
      return true;
    },
  );
});

test('load-test user indexes are clamped to a bounded range', async () => {
  const auth = createLiveChatAuthenticator({
    verifier: stubVerifier(),
    loadTestSecret: 'rehearsal-secret',
  });
  const authenticateAs = (loadTestUser) =>
    auth.authenticate({ loadTestSecret: 'rehearsal-secret', loadTestUser });

  assert.equal((await authenticateAs(-5)).oid, 'LOADTEST#0');
  assert.equal((await authenticateAs(10_000)).oid, 'LOADTEST#999');
});

test('a load-test frame never reaches the token verifier', async () => {
  const verifier = stubVerifier();
  const auth = createLiveChatAuthenticator({ verifier, loadTestSecret: 'rehearsal-secret' });

  await auth.authenticate({ loadTestSecret: 'rehearsal-secret', loadTestUser: 1 });

  assert.deepEqual(verifier.calls, []);
});

test('policy failures close as forbidden and everything else as unauthorized', () => {
  assert.equal(closeCodeForError({ code: 'domain_not_allowed' }), AUTH_CLOSE_CODES.forbidden);
  assert.equal(closeCodeForError({ code: 'guest_account' }), AUTH_CLOSE_CODES.forbidden);
  assert.equal(closeCodeForError({ code: 'bad_tenant' }), AUTH_CLOSE_CODES.forbidden);
  assert.equal(closeCodeForError({ code: 'forbidden' }), AUTH_CLOSE_CODES.forbidden);
  assert.equal(closeCodeForError({ code: 'timeout' }), AUTH_CLOSE_CODES.timeout);

  assert.equal(closeCodeForError({ code: 'bad_signature' }), AUTH_CLOSE_CODES.unauthorized);
  assert.equal(closeCodeForError({ code: 'expired' }), AUTH_CLOSE_CODES.unauthorized);
  // Unrecognised failures must never default to letting the caller in.
  assert.equal(closeCodeForError({ code: 'something-new' }), AUTH_CLOSE_CODES.unauthorized);
  assert.equal(closeCodeForError(undefined), AUTH_CLOSE_CODES.unauthorized);
});

test('the authenticator refuses to start without a verifier', () => {
  assert.throws(() => createLiveChatAuthenticator({}), /verifier/);
});
