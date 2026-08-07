import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRollingEvidenceState,
  CONCEPT_SCORE_CAP,
  EVIDENCE_WINDOW_DAYS,
} from './learnerStore.js';

const at = new Date('2026-08-07T12:00:00.000Z');

function event(signal, weight, occurredAt = at.toISOString(), eventId = `${signal}-${occurredAt}`) {
  return { eventId, signal, weight, occurredAt };
}

test('caps each signal type and the total concept score', () => {
  const incoming = [
    ...Array.from({ length: 5 }, (_, index) => event('rewatched_segment', 1, at.toISOString(), `seek-${index}`)),
    ...Array.from({ length: 4 }, (_, index) => event('repeated_question', 1.25, at.toISOString(), `repeat-${index}`)),
    ...Array.from({ length: 4 }, (_, index) => event('long_pause', 0.5, at.toISOString(), `pause-${index}`)),
    ...Array.from({ length: 4 }, (_, index) => event('reviewed_transcript', 0.25, at.toISOString(), `transcript-${index}`)),
  ];
  const state = buildRollingEvidenceState({ evidenceEvents: [] }, incoming, at);
  assert.equal(state.evidenceEvents.filter((item) => item.signal === 'rewatched_segment').length, 2);
  assert.equal(state.evidenceEvents.filter((item) => item.signal === 'repeated_question').length, 2);
  assert.equal(state.evidenceEvents.filter((item) => item.signal === 'long_pause').length, 2);
  assert.equal(state.evidenceEvents.filter((item) => item.signal === 'reviewed_transcript').length, 2);
  assert.equal(state.evidenceScore, CONCEPT_SCORE_CAP);
  assert.equal(state.evidenceCount, 8);
});

test('drops evidence outside the rolling 30-day window', () => {
  const old = new Date(at.getTime() - (EVIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000) - 1).toISOString();
  const state = buildRollingEvidenceState({
    evidenceEvents: [event('rewatched_segment', 1, old, 'old')],
  }, [event('long_pause', 0.5)], at);
  assert.equal(state.evidenceScore, 0.5);
  assert.equal(state.evidenceCount, 1);
  assert.deepEqual([...state.signals], ['long_pause']);
});

test('does not count a retried analytics event twice', () => {
  const duplicate = event('repeated_question', 1.25, at.toISOString(), 'same-event');
  const state = buildRollingEvidenceState({ evidenceEvents: [duplicate] }, [duplicate], at);
  assert.equal(state.evidenceScore, 1.25);
  assert.equal(state.evidenceCount, 1);
});

test('carries a legacy aggregate only during its first migration window', () => {
  const current = buildRollingEvidenceState({
    evidenceScore: 12.75,
    evidenceCount: 5,
    signals: new Set(['rewatched_segment', 'repeated_question']),
    updatedAt: '2026-08-07T11:00:00.000Z',
  }, [], at);
  assert.equal(current.evidenceScore, 5);
  assert.equal(current.evidenceCount, 5);
  const migrated = buildRollingEvidenceState({
    evidenceEvents: current.evidenceEvents,
    legacyEvidenceScore: current.legacyEvidenceScore,
    legacyEvidenceCount: current.legacyEvidenceCount,
    legacyEvidenceSignals: current.legacyEvidenceSignals,
    legacyEvidenceExpiresAt: current.legacyEvidenceExpiresAt,
  }, [event('long_pause', 0.5)], at);
  assert.equal(migrated.evidenceScore, 5);
  assert.equal(migrated.evidenceCount, 6);

  const expired = buildRollingEvidenceState({
    evidenceScore: 5,
    evidenceCount: 5,
    signals: new Set(['rewatched_segment']),
    updatedAt: '2026-06-01T00:00:00.000Z',
  }, [], at);
  assert.equal(expired.evidenceScore, 0);
  assert.equal(expired.evidenceCount, 0);
});
