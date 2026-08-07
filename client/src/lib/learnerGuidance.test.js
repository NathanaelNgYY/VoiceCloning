import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLearnerSupportGuidance } from './learnerGuidance.js';

test('builds guidance for every qualifying concept without using supervisor rank', () => {
  const guidance = buildLearnerSupportGuidance({
    focusConcepts: ['endoscopy'],
    concepts: [
      { conceptId: 'endoscopy', conceptLabel: 'Endoscopy timing', status: 'possible_support', signals: ['rewatched_segment'] },
      { conceptId: 'varices', conceptLabel: 'Variceal therapy', status: 'support_recommended', signals: ['repeated_question'] },
    ],
  });
  assert.match(guidance, /concept actually asked about/i);
  assert.match(guidance, /Endoscopy timing/);
  assert.match(guidance, /Variceal therapy/);
  assert.match(guidance, /not a ranking/i);
  assert.match(guidance, /preserving medical terminology/i);
});

test('returns no personalization when no concept has a support state', () => {
  assert.equal(buildLearnerSupportGuidance({
    focusConcepts: ['overview'],
    concepts: [{ conceptId: 'overview', conceptLabel: 'Overview', status: 'no_support_inference' }],
  }), '');
});
