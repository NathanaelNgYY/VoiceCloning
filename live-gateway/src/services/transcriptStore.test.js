import assert from 'node:assert/strict';
import test from 'node:test';

import {
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

function harness({ ttlDays = 0, storeSynthetic = false, putItem } = {}) {
  const items = [];
  const errors = [];
  const store = createTranscriptStore({
    putItem: putItem || (async (item) => { items.push(item); }),
    ttlDays,
    storeSynthetic,
    now: () => NOW_MS,
    newSessionId: () => 'session-1',
    logger: { error: (...args) => errors.push(args) },
  });
  return { store, items, errors };
}

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

  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    PK: `USER#${OID}`,
    SK: 'SESSION#session-1#META',
    startedAt: '2026-08-03T09:30:00.000Z',
    email: 'cs-nathanael.ng@assoc.main.ntu.edu.sg',
    displayName: 'Nathanael Ng',
  });
  assert.deepEqual(items[1], {
    PK: `USER#${OID}`,
    SK: 'SESSION#session-1#TURN#000001',
    role: 'user',
    text: 'What is melena?',
    ts: '2026-08-03T09:30:00.000Z',
  });
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

test('a session that never produces a turn writes nothing at all', async () => {
  // Kiosk users open the page and walk away constantly; empty session rows would
  // outnumber real ones.
  const { store, items } = harness();
  store.openSession(IDENTITY);
  await flush();

  assert.deepEqual(items, []);
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

  assert.deepEqual(items, []);
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

  assert.equal(items[0].synthetic, true);
  assert.equal(items[0].PK, 'USER#LOADTEST#4');
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

  assert.equal(errors.length, 2, 'both the meta and turn writes report failure');
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
