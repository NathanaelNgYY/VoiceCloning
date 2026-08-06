import assert from 'node:assert/strict';
import test from 'node:test';

import {
  USER_PROFILE_KEY,
  createTranscriptStore,
  sessionMetaKey,
  turnSortKey,
  userPartitionKey,
} from './transcriptStore.js';

const OID = 'e3f1c0aa-1111-2222-3333-444455556666';
const IDENTITY = {
  oid: OID,
  email: 'cs-nathanael.ng@assoc.main.ntu.edu.sg',
  name: 'Nathanael Ng',
  synthetic: false,
};
const NOW_MS = Date.UTC(2026, 7, 3, 9, 30, 0);

function harness({
  ttlDays = 0,
  storeSynthetic = false,
  storeAssistantTurns = true,
  putItem,
} = {}) {
  const items = [];
  const errors = [];
  const store = createTranscriptStore({
    putItem: putItem || (async (item) => { items.push(item); }),
    ttlDays,
    storeSynthetic,
    // Most cases here are about keys, ttl and failure handling, so they opt in
    // and stay readable. The default-off behaviour has its own tests below.
    storeAssistantTurns,
    now: () => NOW_MS,
    newSessionId: () => 'session-1',
    logger: { error: (...args) => errors.push(args) },
  });
  return { store, items, errors };
}

// Everything except the per-user profile row, which is written on every
// openSession and would otherwise shift the index of each assertion below.
const turnsAndMeta = (items) => items.filter((item) => item.SK !== USER_PROFILE_KEY);

// Writes are fire-and-forget, so tests wait for the microtask queue to drain.
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('key helpers produce sortable, user-partitioned keys', () => {
  assert.equal(userPartitionKey(OID), `USER#${OID}`);
  assert.equal(sessionMetaKey('abc'), 'SESSION#abc#META');
  assert.equal(turnSortKey('abc', 7), 'SESSION#abc#TURN#000007');

  // Zero-padding is what keeps turn 10 after turn 9 under a string sort.
  const keys = [turnSortKey('abc', 9), turnSortKey('abc', 10), turnSortKey('abc', 2)];
  assert.deepEqual([...keys].sort(), [
    turnSortKey('abc', 2),
    turnSortKey('abc', 9),
    turnSortKey('abc', 10),
  ]);
});

test('the first turn writes session metadata then the turn itself', async () => {
  const { store, items } = harness();
  const session = store.openSession(IDENTITY);

  session.recordTurn({ role: 'user', text: 'What is melena?' });
  await flush();

  const items2 = turnsAndMeta(items);
  assert.equal(items2.length, 2);
  assert.deepEqual(items2[0], {
    PK: `USER#${OID}`,
    SK: 'SESSION#session-1#META',
    startedAt: '2026-08-03T09:30:00.000Z',
    email: 'cs-nathanael.ng@assoc.main.ntu.edu.sg',
    displayName: 'Nathanael Ng',
  });
  assert.deepEqual(items2[1], {
    PK: `USER#${OID}`,
    SK: 'SESSION#session-1#TURN#000001',
    role: 'user',
    text: 'What is melena?',
    ts: '2026-08-03T09:30:00.000Z',
  });
});

test('signing in writes the user profile before any turn exists', async () => {
  // The only record of someone who reached the lesson and left without asking
  // anything. Session META cannot serve this: it waits for a first real turn.
  const { store, items } = harness({ ttlDays: 90 });
  store.openSession(IDENTITY);
  await flush();

  assert.deepEqual(items, [{
    PK: `USER#${OID}`,
    SK: USER_PROFILE_KEY,
    lastSeenAt: '2026-08-03T09:30:00.000Z',
    GSI1PK: 'USERS',
    GSI1SK: `2026-08-03T09:30:00.000Z#${OID}`,
    email: 'cs-nathanael.ng@assoc.main.ntu.edu.sg',
    displayName: 'Nathanael Ng',
    ttl: Math.floor(NOW_MS / 1000) + 90 * 86_400,
  }]);
});

test('recordSignIn writes the profile with no session at all', async () => {
  // The whole point of the sign-in endpoint: a student who never opens the
  // WebSocket — never presses the microphone — is still recorded as present.
  const { store, items } = harness({ ttlDays: 90 });
  const recorded = store.recordSignIn(IDENTITY);
  await flush();

  assert.equal(recorded, true);
  assert.deepEqual(items, [{
    PK: `USER#${OID}`,
    SK: USER_PROFILE_KEY,
    lastSeenAt: '2026-08-03T09:30:00.000Z',
    GSI1PK: 'USERS',
    GSI1SK: `2026-08-03T09:30:00.000Z#${OID}`,
    email: 'cs-nathanael.ng@assoc.main.ntu.edu.sg',
    displayName: 'Nathanael Ng',
    ttl: Math.floor(NOW_MS / 1000) + 90 * 86_400,
  }]);
});

test('recordSignIn and openSession write the identical row', async () => {
  // They must stay interchangeable: whichever path runs first, and whichever
  // runs at all, the person is recorded the same way.
  const viaEndpoint = harness();
  const viaSocket = harness();
  viaEndpoint.store.recordSignIn(IDENTITY);
  viaSocket.store.openSession(IDENTITY);
  await flush();

  assert.deepEqual(
    viaEndpoint.items[0],
    viaSocket.items.find((item) => item.SK === USER_PROFILE_KEY),
  );
});

test('recordSignIn drops load-test identities unless they are opted in', async () => {
  const off = harness();
  const on = harness({ storeSynthetic: true });
  const synthetic = { ...IDENTITY, oid: 'LOADTEST#3', synthetic: true };

  assert.equal(off.store.recordSignIn(synthetic), false);
  assert.equal(on.store.recordSignIn(synthetic), true);
  await flush();

  assert.deepEqual(off.items, []);
  assert.equal(on.items[0].synthetic, true);
});

test('recordSignIn refuses an identity with no oid', () => {
  const { store } = harness();
  // Never fall back to email or a generated id: an unattributable row is worse
  // than no row, because it looks like data.
  assert.throws(() => store.recordSignIn({ email: 'a@b.c' }), /oid/u);
  assert.throws(() => store.recordSignIn(null), /oid/u);
});

test('a failed sign-in write is swallowed after logging', async () => {
  const { store, errors } = harness({
    putItem: async () => { throw new Error('DynamoDB is having a bad second'); },
  });

  assert.equal(store.recordSignIn(IDENTITY), true, 'the write was issued');
  await flush();

  assert.equal(errors.length, 1);
});

test('the profile sorts ahead of every session for one Query on the user', async () => {
  // "PROFILE" < "SESSION#…" lexicographically, which is what puts identity first
  // in a Query on PK rather than after an arbitrary number of turns.
  const keys = [sessionMetaKey('a'), USER_PROFILE_KEY, turnSortKey('a', 1)];
  assert.equal([...keys].sort()[0], USER_PROFILE_KEY);
});

test('a returning student refreshes their profile rather than duplicating it', async () => {
  const { store, items } = harness();
  store.openSession(IDENTITY);
  store.openSession(IDENTITY);
  await flush();

  const profiles = items.filter((item) => item.SK === USER_PROFILE_KEY);
  assert.equal(profiles.length, 2, 'both are writes to the same key, so DynamoDB keeps one row');
  assert.equal(profiles[0].PK, profiles[1].PK);
  assert.equal(profiles[0].SK, profiles[1].SK);
});

test('metadata is written once per session, not once per turn', async () => {
  const { store, items } = harness();
  const session = store.openSession(IDENTITY);

  session.recordTurn({ role: 'user', text: 'One' });
  session.recordTurn({ role: 'assistant', text: 'Two' });
  session.recordTurn({ role: 'user', text: 'Three' });
  await flush();

  assert.equal(items.filter((item) => item.SK.endsWith('#META')).length, 1);
  assert.deepEqual(
    items.filter((item) => item.role).map((item) => item.SK),
    [
      'SESSION#session-1#TURN#000001',
      'SESSION#session-1#TURN#000002',
      'SESSION#session-1#TURN#000003',
    ],
  );
});

test('a session that never produces a turn writes no session rows', async () => {
  // Kiosk users open the page and walk away constantly; empty session rows would
  // outnumber real ones. The profile row is still written — that is the point of
  // keeping it separate from session META.
  const { store, items } = harness();
  store.openSession(IDENTITY);
  await flush();

  assert.deepEqual(turnsAndMeta(items), []);
});

test('empty and whitespace-only transcripts are not stored', async () => {
  // Suppressed transcripts arrive as empty strings by design; see
  // openaiRealtimeEvents.mapUserTextDone.
  const { store, items } = harness();
  const session = store.openSession(IDENTITY);

  assert.equal(session.recordTurn({ role: 'user', text: '' }), false);
  assert.equal(session.recordTurn({ role: 'user', text: '   ' }), false);
  assert.equal(session.recordTurn({ role: 'user', text: null }), false);
  await flush();

  assert.deepEqual(turnsAndMeta(items), []);
  assert.equal(session.turnCount, 0);
});

test('text is trimmed and unknown roles are refused', async () => {
  const { store, items } = harness();
  const session = store.openSession(IDENTITY);

  assert.equal(session.recordTurn({ role: 'system', text: 'injected' }), false);
  session.recordTurn({ role: 'assistant', text: '  Melena is dark stool.  ' });
  await flush();

  const turns = items.filter((item) => item.role);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].text, 'Melena is dark stool.');
});

test('a barged-in reply is stored and flagged rather than dropped', async () => {
  const { store, items } = harness();
  const session = store.openSession(IDENTITY);

  session.recordTurn({ role: 'assistant', text: 'Partial reply', cancelled: true });
  await flush();

  assert.equal(items.at(-1).cancelled, true);
});

test('replies are dropped by default and the questions still stored', async () => {
  // What the student asked is the research interest; replies are reproducible
  // from the prompt and the lesson.
  const { store, items } = harness({ storeAssistantTurns: false });
  const session = store.openSession(IDENTITY);

  assert.equal(session.recordTurn({ role: 'user', text: 'What is melena?' }), true);
  assert.equal(session.recordTurn({ role: 'assistant', text: 'Dark tarry stool.' }), false);
  assert.equal(session.recordTurn({ role: 'user', text: 'And haematemesis?' }), true);
  await flush();

  assert.deepEqual(
    items.filter((item) => item.role).map((item) => [item.role, item.SK]),
    [
      ['user', 'SESSION#session-1#TURN#000001'],
      ['user', 'SESSION#session-1#TURN#000002'],
    ],
    'dropped replies must not consume a sequence number and leave gaps',
  );
});

test('a reply-only session writes no session metadata', async () => {
  // The reply is dropped before writeMetaOnce, so a student who never spoke does
  // not get a session row conjured out of the assistant greeting them.
  const { store, items } = harness({ storeAssistantTurns: false });
  const session = store.openSession(IDENTITY);

  session.recordTurn({ role: 'assistant', text: 'Hello, ask me anything.' });
  await flush();

  assert.deepEqual(turnsAndMeta(items), []);
});

test('replies are stored when explicitly enabled', async () => {
  const { store, items } = harness({ storeAssistantTurns: true });
  const session = store.openSession(IDENTITY);

  session.recordTurn({ role: 'user', text: 'What is melena?' });
  assert.equal(session.recordTurn({ role: 'assistant', text: 'Dark tarry stool.' }), true);
  await flush();

  assert.deepEqual(
    items.filter((item) => item.role).map((item) => item.role),
    ['user', 'assistant'],
  );
});

test('no ttl attribute is written when retention is unset', async () => {
  // Retention is an open policy question; items must not silently expire.
  const { store, items } = harness({ ttlDays: 0 });
  store.openSession(IDENTITY).recordTurn({ role: 'user', text: 'Hello' });
  await flush();

  for (const item of items) {
    assert.equal('ttl' in item, false);
  }
});

test('ttl is an epoch-seconds expiry when retention is configured', async () => {
  const { store, items } = harness({ ttlDays: 365 });
  store.openSession(IDENTITY).recordTurn({ role: 'user', text: 'Hello' });
  await flush();

  const expected = Math.floor(NOW_MS / 1000) + 365 * 86_400;
  for (const item of items) {
    assert.equal(item.ttl, expected);
  }
});

test('load-test sessions are dropped by default', async () => {
  const { store, items } = harness();
  const session = store.openSession({ ...IDENTITY, oid: 'LOADTEST#4', synthetic: true });

  assert.equal(session.recordTurn({ role: 'user', text: 'Rehearsal question' }), false);
  await flush();

  assert.deepEqual(items, [], 'a 150-user rehearsal must not bury real transcripts');
});

test('load-test sessions are stored and marked when explicitly enabled', async () => {
  const { store, items } = harness({ storeSynthetic: true });
  const session = store.openSession({ ...IDENTITY, oid: 'LOADTEST#4', synthetic: true });

  session.recordTurn({ role: 'user', text: 'Rehearsal question' });
  await flush();

  // The profile is written first and carries the same marking, so a rehearsal is
  // identifiable at the user level, not only session by session. Turn rows are
  // deliberately unmarked — their partition already says LOADTEST.
  assert.equal(items[0].SK, USER_PROFILE_KEY);
  assert.equal(items[0].synthetic, true);
  assert.equal(items.find((item) => item.SK.endsWith('#META')).synthetic, true);
  for (const item of items) {
    assert.equal(item.PK, 'USER#LOADTEST#4');
  }
});

test('a storage failure is logged and never surfaces to the caller', async () => {
  // The rule that outranks everything else in this module: a bad second in
  // DynamoDB must not end a student's conversation.
  const { store, errors } = harness({
    putItem: async () => { throw new Error('ProvisionedThroughputExceeded'); },
  });
  const session = store.openSession(IDENTITY);

  assert.equal(session.recordTurn({ role: 'user', text: 'Hello' }), true);
  await flush();

  assert.equal(errors.length, 3, 'the profile, meta and turn writes each report failure');
  assert.match(errors[0][1].message, /ProvisionedThroughputExceeded/);
});

test('sessions from the same user do not share a turn sequence', async () => {
  const items = [];
  let counter = 0;
  const store = createTranscriptStore({
    putItem: async (item) => { items.push(item); },
    now: () => NOW_MS,
    newSessionId: () => `session-${++counter}`,
  });

  store.openSession(IDENTITY).recordTurn({ role: 'user', text: 'First visit' });
  store.openSession(IDENTITY).recordTurn({ role: 'user', text: 'Second visit' });
  await flush();

  const turnKeys = items.filter((item) => item.role).map((item) => item.SK);
  assert.deepEqual(turnKeys, [
    'SESSION#session-1#TURN#000001',
    'SESSION#session-2#TURN#000001',
  ]);
});

test('opening a session without an identity is refused', () => {
  const { store } = harness();

  assert.throws(() => store.openSession(null), /oid/);
  assert.throws(() => store.openSession({ email: 'x@y.z' }), /oid/);
});

test('the store refuses to build without a putItem', () => {
  assert.throws(() => createTranscriptStore({}), /putItem/);
});
