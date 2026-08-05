import assert from 'node:assert/strict';
import test from 'node:test';

import { deidentifyItem, pseudonymize } from './export-transcripts-deidentified.mjs';

const SALT = 'test-salt';
const OID = 'e3f1c0aa-1111-2222-3333-444455556666';

const turnItem = {
  PK: `USER#${OID}`,
  SK: 'SESSION#session-1#TURN#000002',
  role: 'user',
  text: 'My father has black stools, should he worry?',
  ts: '2026-08-03T09:30:00.000Z',
  ttl: 1_777_000_000,
};

test('an exported turn carries no identifier and no expiry', () => {
  const row = deidentifyItem(turnItem, SALT);

  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes(OID), false, 'the oid must not survive export');
  assert.equal(serialized.includes('@'), false, 'no email may appear');
  assert.equal('ttl' in row, false, 'de-identified data carries no retention limit');

  assert.equal(row.role, 'user');
  assert.equal(row.text, 'My father has black stools, should he worry?');
  assert.equal(row.turn, 2);
});

test('session metadata is dropped rather than scrubbed', () => {
  // It exists only to hold email and display name, which research does not need.
  const meta = {
    PK: `USER#${OID}`,
    SK: 'SESSION#session-1#META',
    email: 'cs-nathanael.ng@assoc.main.ntu.edu.sg',
    displayName: 'Nathanael Ng',
  };

  assert.equal(deidentifyItem(meta, SALT), null);
});

test('one participant stays one participant across turns and sessions', () => {
  // Grouping has to survive de-identification or the export is useless for
  // "how many questions did a student ask".
  const second = deidentifyItem({ ...turnItem, SK: 'SESSION#session-2#TURN#000001' }, SALT);
  const first = deidentifyItem(turnItem, SALT);

  assert.equal(first.participant, second.participant);
  assert.notEqual(first.session, second.session, 'separate visits stay separate');
});

test('different people do not collide', () => {
  const other = deidentifyItem({ ...turnItem, PK: 'USER#different-oid' }, SALT);

  assert.notEqual(deidentifyItem(turnItem, SALT).participant, other.participant);
});

test('a different salt yields different pseudonyms for the same person', () => {
  // Prevents linking two exports back together — and, with a random salt, keeps
  // the mapping unrecoverable once the run ends.
  assert.notEqual(pseudonymize(OID, 'salt-a'), pseudonymize(OID, 'salt-b'));
});

test('cancelled and synthetic flags survive for filtering', () => {
  const row = deidentifyItem({ ...turnItem, cancelled: true, synthetic: true }, SALT);

  assert.equal(row.cancelled, true);
  assert.equal(row.synthetic, true);
});
