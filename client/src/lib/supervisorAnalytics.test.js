import assert from 'node:assert/strict';
import test from 'node:test';

import { conceptStatusLabel, lessonAnalytics, rankConcepts } from './supervisorAnalytics.js';

const lesson = {
  concepts: [
    { conceptId: 'overview', conceptLabel: 'Overview', status: 'insufficient_evidence', evidenceScore: 0.5, evidenceCount: 1, signals: ['long_pause'] },
    { conceptId: 'endoscopy', conceptLabel: 'Endoscopy', status: 'needs_review', evidenceScore: 3.25, evidenceCount: 3, signals: ['repeated_question', 'repeated_question', 'rewatched_segment'] },
    { conceptId: 'risk', conceptLabel: 'Risk', status: 'possible_uncertainty', evidenceScore: 1.5, evidenceCount: 2, signals: ['long_pause'] },
  ],
};

test('concepts are ranked by review status and score', () => {
  assert.deepEqual(rankConcepts(lesson).map((item) => item.conceptId), ['endoscopy', 'risk', 'overview']);
});

test('analytics excludes insufficient evidence from the chart and deduplicates signal labels', () => {
  const analytics = lessonAnalytics(lesson);
  assert.equal(analytics.visibleConcepts.length, 2);
  assert.equal(analytics.maxScore, 3.25);
  assert.equal(analytics.totalEvidence, 6);
  assert.equal(analytics.needsReviewCount, 1);
  assert.deepEqual(analytics.visibleConcepts[0].signals, ['repeated_question', 'rewatched_segment']);
});

test('status labels remain cautious', () => {
  assert.equal(conceptStatusLabel('possible_uncertainty'), 'Possible uncertainty');
  assert.equal(conceptStatusLabel('unknown'), 'Not enough evidence');
});

