import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRollingEvidenceState,
  CONCEPT_SCORE_CAP,
  createLearnerStore,
  EVIDENCE_WINDOW_DAYS,
} from './learnerStore.js';

const at = new Date('2026-08-07T12:00:00.000Z');

function event(signal, weight, occurredAt = at.toISOString(), eventId = `${signal}-${occurredAt}`) {
  return { eventId, signal, weight, occurredAt };
}

test('caps each signal type and the total concept score', () => {
  const incoming = [
    ...Array.from({ length: 5 }, (_, index) => event('rewatched_segment', 0.5, at.toISOString(), `seek-${index}`)),
    ...Array.from({ length: 4 }, (_, index) => event('repeated_question', 1, at.toISOString(), `repeat-${index}`)),
  ];
  const state = buildRollingEvidenceState({ evidenceEvents: [] }, incoming, at);
  assert.equal(state.evidenceEvents.filter((item) => item.signal === 'rewatched_segment').length, 2);
  assert.equal(state.evidenceEvents.filter((item) => item.signal === 'repeated_question').length, 2);
  assert.equal(state.evidenceScore, CONCEPT_SCORE_CAP);
  assert.equal(state.evidenceCount, 4);
});

test('drops evidence outside the rolling 30-day window', () => {
  const old = new Date(at.getTime() - (EVIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000) - 1).toISOString();
  const state = buildRollingEvidenceState({
    evidenceEvents: [event('rewatched_segment', 0.5, old, 'old')],
  }, [event('repeated_question', 1)], at);
  assert.equal(state.evidenceScore, 1);
  assert.equal(state.evidenceCount, 1);
  assert.deepEqual([...state.signals], ['repeated_question']);
});

test('does not count a retried analytics event twice', () => {
  const duplicate = event('repeated_question', 1, at.toISOString(), 'same-event');
  const state = buildRollingEvidenceState({ evidenceEvents: [duplicate] }, [duplicate], at);
  assert.equal(state.evidenceScore, 1);
  assert.equal(state.evidenceCount, 1);
});

test('carries a legacy aggregate only during its first migration window', () => {
  const current = buildRollingEvidenceState({
    evidenceScore: 12.75,
    evidenceCount: 5,
    signals: new Set(['rewatched_segment', 'repeated_question']),
    updatedAt: '2026-08-07T11:00:00.000Z',
  }, [], at);
  assert.equal(current.evidenceScore, 3);
  assert.equal(current.evidenceCount, 4);
  const migrated = buildRollingEvidenceState({
    evidenceEvents: current.evidenceEvents,
    legacyEvidenceScore: current.legacyEvidenceScore,
    legacyEvidenceCount: current.legacyEvidenceCount,
    legacyEvidenceSignals: current.legacyEvidenceSignals,
    legacyEvidenceExpiresAt: current.legacyEvidenceExpiresAt,
  }, [event('repeated_question', 1)], at);
  assert.equal(migrated.evidenceScore, 3);
  assert.equal(migrated.evidenceCount, 4);

  const expired = buildRollingEvidenceState({
    evidenceScore: 5,
    evidenceCount: 5,
    signals: new Set(['rewatched_segment']),
    updatedAt: '2026-06-01T00:00:00.000Z',
  }, [], at);
  assert.equal(expired.evidenceScore, 0);
  assert.equal(expired.evidenceCount, 0);
});

test('a recorded batch summarises untouched concepts from the rolling window, not stored totals', async () => {
  const stale = new Date(at.getTime() - (EVIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000) - 1).toISOString();
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command);
      const name = command.constructor.name;
      if (name === 'GetCommand') return {};
      if (name === 'QueryCommand') {
        return { Items: [{
          conceptId: 'endoscopy',
          conceptLabel: 'Endoscopy timing and therapy',
          evidenceScore: 2,
          evidenceCount: 2,
          evidenceEvents: [
            event('repeated_question', 1, stale, 'stale-1'),
            event('repeated_question', 1, stale, 'stale-2'),
          ],
        }] };
      }
      return {};
    },
  };
  const store = createLearnerStore({ tableName: 'learners', client, now: () => at });
  await store.recordBatch({ oid: 'user-1' }, [{
    eventId: 'seek-1',
    eventName: 'video_seek',
    lessonSlug: 'gi-bleeding',
    videoTime: 400,
    occurredAt: at.toISOString(),
    properties: { direction: 'backward' },
  }]);

  const put = commands.find((command) => command.constructor.name === 'PutCommand');
  assert.equal(put.input.Item.source, 'rules');
  assert.equal(put.input.Item.concepts[0].evidenceScore, 0);
  assert.equal(put.input.Item.concepts[0].status, 'no_support_inference');
  assert.deepEqual(put.input.Item.focusConcepts, []);
});
