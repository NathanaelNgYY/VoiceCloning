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
    weight: 0.5,
  });
});

test('weights a repeated question only when both timestamps belong to the same concept', () => {
  const event = {
    lessonSlug: 'gi-bleeding',
    eventName: 'repeated_question',
    videoTime: 390,
    properties: { previousVideoTime: 380, similarity: 0.8 },
  };
  assert.equal(evidenceFromEvent(event)?.weight, 1);
  assert.equal(evidenceFromEvent({
    ...event,
    properties: { previousVideoTime: 520, similarity: 0.8 },
  }), null);
  assert.equal(evidenceFromEvent({
    ...event,
    properties: { previousVideoTime: 380, similarity: 0.5 },
  }), null);
});

test('semantic agreement keeps repeated-question evidence when the video moved', () => {
  const result = evidenceFromEvent({
    lessonSlug: 'gi-bleeding',
    eventName: 'repeated_question',
    videoTime: 520,
    properties: {
      previousVideoTime: 380,
      similarity: 0.8,
      semanticConceptId: 'endoscopy',
      semanticConfidence: 1,
    },
  });
  assert.equal(result?.concept.id, 'endoscopy');
  assert.equal(result?.weight, 1);
});

test('a concept question is weak evidence without requiring repetition', () => {
  const semantic = evidenceFromEvent({
    lessonSlug: 'gi-bleeding',
    eventName: 'question_asked',
    videoTime: 520,
    properties: { semanticConceptId: 'endoscopy', semanticConfidence: 1 },
  });
  assert.equal(semantic?.concept.id, 'endoscopy');
  assert.equal(semantic?.signal, 'concept_question');
  assert.equal(semantic?.weight, 0.5);

  const timestamp = evidenceFromEvent({
    lessonSlug: 'gi-bleeding',
    eventName: 'question_asked',
    videoTime: 520,
    properties: {},
  });
  assert.equal(timestamp?.concept.id, 'lower-gi-bleeding');
  assert.equal(timestamp?.weight, 0.5);
  assert.equal(evidenceFromEvent({
    lessonSlug: 'gi-bleeding',
    eventName: 'question_asked',
    videoTime: 390,
    properties: { isRepeated: true, semanticConceptId: 'endoscopy', semanticConfidence: 1 },
  }), null);
});

test('unknown or low-confidence semantic concepts cannot override timestamp disagreement', () => {
  const base = {
    lessonSlug: 'gi-bleeding',
    eventName: 'repeated_question',
    videoTime: 520,
    properties: { previousVideoTime: 380, similarity: 0.8 },
  };
  assert.equal(evidenceFromEvent({
    ...base,
    properties: { ...base.properties, semanticConceptId: 'invented', semanticConfidence: 1 },
  }), null);
  assert.equal(evidenceFromEvent({
    ...base,
    properties: { ...base.properties, semanticConceptId: 'endoscopy', semanticConfidence: 0.5 },
  }), null);
});

test('uses conservative support thresholds without claiming uncertainty', () => {
  assert.equal(statusForEvidence(0.5), 'no_support_inference');
  assert.equal(statusForEvidence(1), 'possible_support');
  assert.equal(statusForEvidence(2), 'support_recommended');
});

test('passive pause and transcript behaviour does not infer support need', () => {
  assert.equal(evidenceFromEvent({
    lessonSlug: 'gi-bleeding',
    eventName: 'video_play',
    videoTime: 390,
    properties: { pauseDurationSeconds: 30 },
  }), null);
  assert.equal(evidenceFromEvent({
    lessonSlug: 'gi-bleeding',
    eventName: 'transcript_scrolled',
    videoTime: 390,
  }), null);
});

test('summary exposes only sufficiently supported learning focuses', () => {
  assert.deepEqual(buildLearnerSummary([
    { conceptId: 'a', conceptLabel: 'Concept A', evidenceScore: 3 },
    { conceptId: 'b', conceptLabel: 'Concept B', evidenceScore: 0.5 },
  ]), {
    summary: 'Recent behaviour suggests gently offering additional support for Concept A. Do not claim that the learner is uncertain or lacks knowledge.',
    focusConcepts: ['a'],
  });
});
