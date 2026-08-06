import assert from 'node:assert/strict';
import test from 'node:test';

import {
  groupSessionsIntoVisits,
  parseSessionKey,
  sessionStartedAt,
  shapeUserRows,
} from './read-transcripts.mjs';

const OID = 'USER#e3f1c0aa-1111-2222-3333-444455556666';

test('parses both session key formats', () => {
  // Current: the id leads with the open time and contains a # of its own.
  assert.deepEqual(
    parseSessionKey('SESSION#2026-08-06T07:26:13.774Z#a1b2c3d4#META'),
    { sessionId: '2026-08-06T07:26:13.774Z#a1b2c3d4', kind: 'meta' },
  );
  assert.deepEqual(
    parseSessionKey('SESSION#2026-08-06T07:26:13.774Z#a1b2c3d4#TURN#000012'),
    { sessionId: '2026-08-06T07:26:13.774Z#a1b2c3d4', kind: 'turn', sequence: 12 },
  );

  // Legacy bare UUIDs, which stay in the table until their TTL expires. Parsing
  // from the left would have mangled the format above; parsing from the right
  // handles both, which is why it reads backwards.
  assert.deepEqual(
    parseSessionKey('SESSION#53e698f6-0d9b-4e17-b4ae-179ea3a990e1#META'),
    { sessionId: '53e698f6-0d9b-4e17-b4ae-179ea3a990e1', kind: 'meta' },
  );
  assert.deepEqual(
    parseSessionKey('SESSION#53e698f6-0d9b-4e17-b4ae-179ea3a990e1#TURN#000001'),
    { sessionId: '53e698f6-0d9b-4e17-b4ae-179ea3a990e1', kind: 'turn', sequence: 1 },
  );
});

test('ignores rows that are not sessions', () => {
  assert.equal(parseSessionKey('PROFILE'), null);
  assert.equal(parseSessionKey('SIGNIN#2026-08-06T07:10:43.665Z'), null);
  assert.equal(parseSessionKey(undefined), null);
});

test('falls back through three sources for a session start time', () => {
  // The META row wins when present — it is the only authoritative one.
  assert.equal(
    sessionStartedAt({ sessionId: 'anything', startedAt: '2026-08-06T01:00:00.000Z', turns: [] }),
    '2026-08-06T01:00:00.000Z',
  );
  // No META (the student opened a socket and said nothing): use the id itself.
  assert.equal(
    sessionStartedAt({ sessionId: '2026-08-06T02:00:00.000Z#a1b2c3d4', startedAt: '', turns: [] }),
    '2026-08-06T02:00:00.000Z',
  );
  // A legacy UUID carries no time at all — the first turn is all there is.
  assert.equal(
    sessionStartedAt({
      sessionId: '53e698f6-0d9b-4e17-b4ae-179ea3a990e1',
      startedAt: '',
      turns: [{ ts: '2026-08-06T03:00:00.000Z' }],
    }),
    '2026-08-06T03:00:00.000Z',
  );
});

test('attaches each session to the visit it happened during', () => {
  const signIns = [
    { signedInAt: '2026-08-06T09:00:00.000Z' },
    { signedInAt: '2026-08-06T11:00:00.000Z' },
  ];
  const sessions = [
    { sessionId: 'a', startedAt: '2026-08-06T09:05:00.000Z', turns: [] },
    { sessionId: 'b', startedAt: '2026-08-06T09:40:00.000Z', turns: [] },
    { sessionId: 'c', startedAt: '2026-08-06T11:30:00.000Z', turns: [] },
  ];

  const { visits, orphans } = groupSessionsIntoVisits(signIns, sessions);

  // The point of the whole exercise: log out, log back in, start a new
  // conversation, and the two visits stay separate instead of being one blur.
  assert.deepEqual(visits.map((v) => v.sessions.map((s) => s.sessionId)), [['a', 'b'], ['c']]);
  assert.equal(orphans.length, 0);
});

test('a session with no preceding sign-in is reported, not silently dropped', () => {
  // Happens for rows written before the sign-in endpoint existed, or when that
  // call failed. Hiding them would misrepresent how much data there is.
  const { visits, orphans } = groupSessionsIntoVisits(
    [{ signedInAt: '2026-08-06T09:00:00.000Z' }],
    [{ sessionId: 'early', startedAt: '2026-08-06T08:00:00.000Z', turns: [] }],
  );

  assert.deepEqual(orphans.map((s) => s.sessionId), ['early']);
  assert.deepEqual(visits[0].sessions, []);
});

test('folds raw rows into a profile, visits and ordered sessions', () => {
  const rows = [
    { PK: OID, SK: 'PROFILE', displayName: 'Nathanael Ng', lastSeenAt: '2026-08-06T07:27:25.760Z' },
    { PK: OID, SK: 'SIGNIN#2026-08-06T07:20:00.000Z', signedInAt: '2026-08-06T07:20:00.000Z' },
    // Deliberately out of order, and the later session listed first — exactly
    // what DynamoDB returns for the legacy UUID keys.
    {
      PK: OID,
      SK: 'SESSION#24a89949-05e7-4126-824d-333a37a4bf5c#META',
      startedAt: '2026-08-06T07:27:27.358Z',
    },
    {
      PK: OID,
      SK: 'SESSION#24a89949-05e7-4126-824d-333a37a4bf5c#TURN#000001',
      role: 'user',
      text: 'hi',
      ts: '2026-08-06T07:27:27.358Z',
    },
    {
      PK: OID,
      SK: 'SESSION#53e698f6-0d9b-4e17-b4ae-179ea3a990e1#META',
      startedAt: '2026-08-06T07:26:13.774Z',
    },
    {
      PK: OID,
      SK: 'SESSION#53e698f6-0d9b-4e17-b4ae-179ea3a990e1#TURN#000001',
      role: 'user',
      text: 'hello what is GI bleeding',
      ts: '2026-08-06T07:26:13.774Z',
    },
  ];

  const { profile, signIns, sessions } = shapeUserRows(rows);

  assert.equal(profile.displayName, 'Nathanael Ng');
  assert.equal(signIns.length, 1);
  // Re-sorted by start time, so the 07:26 session precedes the 07:27 one even
  // though the table hands them back the other way round.
  assert.deepEqual(sessions.map((s) => s.startedAt), [
    '2026-08-06T07:26:13.774Z',
    '2026-08-06T07:27:27.358Z',
  ]);
  assert.deepEqual(sessions[0].turns.map((t) => t.text), ['hello what is GI bleeding']);
});

test('turns come back in sequence order regardless of arrival order', () => {
  const rows = [3, 1, 2].map((n) => ({
    PK: OID,
    SK: `SESSION#s#TURN#00000${n}`,
    role: 'user',
    text: `turn ${n}`,
    ts: '2026-08-06T07:00:00.000Z',
  }));

  const { sessions } = shapeUserRows(rows);

  assert.deepEqual(sessions[0].turns.map((t) => t.text), ['turn 1', 'turn 2', 'turn 3']);
});
