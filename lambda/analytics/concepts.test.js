import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLearnerSummary,
  conceptAt,
  evidenceFromEvent,
  statusForEvidence,
} from './concepts.js';

test('maps a lesson timestamp to the authored concept range', () => {
  assert.equal(conceptAt('gi-bleeding', 175)?.id, 'investigations-risk-stratification');
  assert.equal(conceptAt('unknown', 175), null);
});

test('derives evidence from recorded behavior rather than inventing it', () => {
  assert.deepEqual(evidenceFromEvent({
    lessonSlug: 'gi-bleeding',
    eventName: 'video_seek',
    videoTime: 175,
    properties: { direction: 'backward', fromSeconds: 180, toSeconds: 170 },
  }), {
    concept: {
      id: 'investigations-risk-stratification',
      label: 'Investigations and risk stratification',
      start: 163.66,
      end: 187.5,
    },
    signal: 'rewatched_segment',
    weight: 1,
  });
});

test('uses fixed evidence thresholds for learner status', () => {
  assert.equal(statusForEvidence(1), 'insufficient_evidence');
  assert.equal(statusForEvidence(2), 'possible_uncertainty');
  assert.equal(statusForEvidence(3), 'needs_review');
});

test('summary exposes only sufficiently supported learning focuses', () => {
  assert.deepEqual(buildLearnerSummary([
    { conceptId: 'a', conceptLabel: 'Concept A', evidenceScore: 3 },
    { conceptId: 'b', conceptLabel: 'Concept B', evidenceScore: 1 },
  ]), {
    summary: 'Recent learning behaviour suggests reviewing Concept A. Treat these as teaching signals, not a formal assessment.',
    focusConcepts: ['a'],
  });
});
