import assert from 'node:assert/strict';
import test from 'node:test';

import { conceptStatusLabel, evidenceContributions, lessonAnalytics, rankConcepts } from './supervisorAnalytics.js';

const lesson = {
  concepts: [
    { conceptId: 'overview', conceptLabel: 'Overview', status: 'no_support_inference', evidenceScore: 0.5, evidenceCount: 1, signals: ['long_pause'] },
    { conceptId: 'endoscopy', conceptLabel: 'Endoscopy', status: 'support_recommended', evidenceScore: 3, evidenceCount: 3, signals: ['repeated_question', 'repeated_question', 'rewatched_segment'], evidenceEvents: [
      { eventId: 'older', signal: 'rewatched_segment', occurredAt: '2026-08-09T10:00:00.000Z' },
      { eventId: 'newer', signal: 'repeated_question', occurredAt: '2026-08-10T10:00:00.000Z' },
    ] },
    { conceptId: 'risk', conceptLabel: 'Risk', status: 'possible_support', evidenceScore: 1, evidenceCount: 2, signals: ['rewatched_segment'] },
  ],
};

test('concepts are ranked by review status and score', () => {
  assert.deepEqual(rankConcepts(lesson).map((item) => item.conceptId), ['endoscopy', 'risk', 'overview']);
});

test('analytics excludes insufficient evidence from the chart and deduplicates signal labels', () => {
  const analytics = lessonAnalytics(lesson);
  assert.equal(analytics.visibleConcepts.length, 2);
  assert.equal(analytics.maxScore, 3);
  assert.equal(analytics.totalEvidence, 6);
  assert.equal(analytics.needsReviewCount, 1);
  assert.deepEqual(analytics.visibleConcepts[0].signals, ['repeated_question', 'rewatched_segment']);
  assert.deepEqual(analytics.visibleConcepts[0].evidenceEvents.map((event) => event.eventId), ['newer', 'older']);
});

test('status labels remain cautious', () => {
  assert.equal(conceptStatusLabel('possible_support'), 'Possible support');
  assert.equal(conceptStatusLabel('unknown'), 'No support inference');
});

test('effective evidence contributions mirror decay and logarithmic rank increments', () => {
  const at = new Date('2026-08-11T10:00:00.000Z');
  const events = evidenceContributions([
    { eventId: 'second', signal: 'repeated_question', weight: 1, occurredAt: at.toISOString() },
    { eventId: 'first', signal: 'repeated_question', weight: 1, occurredAt: at.toISOString() },
    { eventId: 'rewind', signal: 'rewatched_segment', weight: 0.5, occurredAt: at.toISOString() },
  ], at);
  const repeated = events.filter((event) => event.signal === 'repeated_question');
  assert.equal(repeated[0].effectiveContribution, 1);
  assert.equal(Math.round(repeated[1].effectiveContribution * 1000) / 1000, 0.585);
  assert.equal(events.find((event) => event.eventId === 'rewind').effectiveContribution, 0.5);
});

