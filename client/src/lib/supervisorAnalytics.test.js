import assert from 'node:assert/strict';
import test from 'node:test';

import { conceptStatusLabel, lessonAnalytics, rankConcepts } from './supervisorAnalytics.js';

const lesson = {
  concepts: [
    { conceptId: 'overview', conceptLabel: 'Overview', status: 'no_support_inference', evidenceScore: 0.5, evidenceCount: 1, signals: ['long_pause'] },
    { conceptId: 'endoscopy', conceptLabel: 'Endoscopy', status: 'support_recommended', evidenceScore: 3, evidenceCount: 3, signals: ['repeated_question', 'repeated_question', 'rewatched_segment'] },
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
});

test('status labels remain cautious', () => {
  assert.equal(conceptStatusLabel('possible_support'), 'Possible support');
  assert.equal(conceptStatusLabel('unknown'), 'No support inference');
});

