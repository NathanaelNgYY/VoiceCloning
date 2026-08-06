import assert from 'node:assert/strict';
import test from 'node:test';

import { bearerToken, createSignInHandler, statusForError } from './signIn.js';

const IDENTITY = {
  oid: 'e3f1c0aa-1111-2222-3333-444455556666',
  email: 'cs-nathanael.ng@assoc.main.ntu.edu.sg',
  name: 'Nathanael Ng',
  synthetic: false,
};

class TokenError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Minimal express-shaped response that records what the handler sent. */
function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function harness({
  authenticate = async () => IDENTITY,
  recordSignIn = () => true,
  authenticator,
  transcriptStore,
  storageConfigured = true,
} = {}) {
  const seen = { frames: [], identities: [], recordOptions: [] };
  const errors = [];

  const handler = createSignInHandler({
    authenticator: authenticator === undefined
      ? {
        authenticate: async (frame) => {
          seen.frames.push(frame);
          return authenticate(frame);
        },
      }
      : authenticator,
    transcriptStore: transcriptStore === undefined
      ? {
        recordSignIn: (identity, options) => {
          seen.identities.push(identity);
          seen.recordOptions.push(options);
          return recordSignIn(identity, options);
        },
      }
      : transcriptStore,
    storageConfigured,
    logger: { error: (...args) => errors.push(args) },
  });

  return { handler, seen, errors };
}

function request(authorization) {
  return { headers: authorization === undefined ? {} : { authorization } };
}

test('asks for a per-visit event row, unlike the socket path', async () => {
  // This route is the one place a login is counted: it fires once per browser
  // sign-in, whereas openSession runs again on every socket reconnect.
  const { handler, seen } = harness();

  await handler(request('Bearer good.token.here'), fakeResponse());

  assert.deepEqual(seen.recordOptions, [{ event: true }]);
});

test('records the sign-in and reports it', async () => {
  const { handler, seen } = harness();
  const res = fakeResponse();

  await handler(request('Bearer good.token.here'), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, recorded: true, storage: 'enabled' });
  assert.deepEqual(seen.identities, [IDENTITY]);
});

test('passes only the token — never a load-test bypass', async () => {
  const { handler, seen } = harness();

  await handler(request('Bearer good.token.here'), fakeResponse());

  assert.deepEqual(seen.frames, [{
    token: 'good.token.here',
    loadTestSecret: '',
    loadTestUser: 0,
  }]);
});

test('rejects a request with no Authorization header', async () => {
  const { handler, seen } = harness();
  const res = fakeResponse();

  await handler(request(), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'missing');
  // Nothing was written for a caller who never proved who they are.
  assert.deepEqual(seen.identities, []);
});

test('rejects a malformed Authorization header', async () => {
  const { handler } = harness();

  for (const header of ['', 'Bearer', 'Bearer   ', 'Basic abc123', 'good.token.here']) {
    const res = fakeResponse();
    await handler(request(header), res);
    assert.equal(res.statusCode, 401, `expected 401 for ${JSON.stringify(header)}`);
  }
});

test('a rejected token is 401 and writes nothing', async () => {
  const { handler, seen } = harness({
    authenticate: async () => {
      throw new TokenError('unknown_key', 'Signing key not found.');
    },
  });
  const res = fakeResponse();

  await handler(request('Bearer forged.token'), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'unknown_key');
  assert.deepEqual(seen.identities, []);
});

test('a wrong-domain account is 403, not 401', async () => {
  const { handler } = harness({
    authenticate: async () => {
      throw new TokenError('domain_not_allowed', 'Domain is not permitted.');
    },
  });
  const res = fakeResponse();

  await handler(request('Bearer other.tenant.token'), res);

  assert.equal(res.statusCode, 403);
});

test('an unrecognised failure defaults to 401 rather than success', async () => {
  const { handler } = harness({
    authenticate: async () => {
      throw new Error('something unexpected');
    },
  });
  const res = fakeResponse();

  await handler(request('Bearer any.token'), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

test('a misconfigured gateway is 503 — our fault, not the caller\'s', async () => {
  const { handler } = harness({
    authenticate: async () => {
      throw new TokenError('misconfigured', 'Live chat authentication is not configured.');
    },
  });
  const res = fakeResponse();

  await handler(request('Bearer any.token'), res);

  assert.equal(res.statusCode, 503);
});

test('reports 503 when authentication is switched off entirely', async () => {
  const { handler } = harness({ authenticator: null });
  const res = fakeResponse();

  await handler(request('Bearer any.token'), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'auth_disabled');
});

test('succeeds with storage disabled, and says so', async () => {
  const { handler } = harness({ transcriptStore: null, storageConfigured: false });
  const res = fakeResponse();

  await handler(request('Bearer good.token.here'), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, recorded: false, storage: 'disabled' });
});

test('a skipped write reports recorded:false while storage stays enabled', async () => {
  // What a synthetic identity looks like: storage is on, this row was not wanted.
  const { handler } = harness({ recordSignIn: () => false });
  const res = fakeResponse();

  await handler(request('Bearer good.token.here'), res);

  assert.deepEqual(res.body, { ok: true, recorded: false, storage: 'enabled' });
});

test('a throwing store is logged, not returned as a failure', async () => {
  const { handler, errors } = harness({
    recordSignIn: () => {
      throw new Error('DynamoDB is having a bad second');
    },
  });
  const res = fakeResponse();

  await handler(request('Bearer good.token.here'), res);

  // The student signed in successfully; storage is our problem, not theirs.
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.recorded, false);
  assert.equal(errors.length, 1);
});

test('bearerToken extracts the token and nothing else', () => {
  assert.equal(bearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
  assert.equal(bearerToken('bearer abc.def.ghi'), 'abc.def.ghi');
  assert.equal(bearerToken('  Bearer   abc.def.ghi  '), 'abc.def.ghi');
  assert.equal(bearerToken('Basic abc'), '');
  assert.equal(bearerToken('Bearer'), '');
  assert.equal(bearerToken(undefined), '');
  assert.equal(bearerToken(['Bearer abc']), '');
});

test('statusForError never turns a failure into a success', () => {
  assert.equal(statusForError({ code: 'guest_account' }), 403);
  assert.equal(statusForError({ code: 'bad_tenant' }), 403);
  assert.equal(statusForError({ code: 'forbidden' }), 403);
  assert.equal(statusForError({ code: 'misconfigured' }), 503);
  assert.equal(statusForError({ code: 'expired' }), 401);
  assert.equal(statusForError(null), 401);
  assert.equal(statusForError(undefined), 401);
});
