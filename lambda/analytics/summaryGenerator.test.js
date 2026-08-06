import assert from 'node:assert/strict';
import test from 'node:test';

import { createSummaryGenerator } from './summaryGenerator.js';

const states = [{
  conceptId: 'risk',
  conceptLabel: 'Risk stratification',
  status: 'needs_review',
  evidenceScore: 3,
  evidenceCount: 3,
  signals: new Set(['rewatched_segment']),
}];

test('uses deterministic guidance when no LLM credential is configured', async () => {
  const generate = createSummaryGenerator({ apiKey: '' });
  const result = await generate(states);
  assert.equal(result.source, 'rules');
  assert.deepEqual(result.focusConcepts, ['risk']);
});

test('accepts structured LLM output and filters invented concept ids', async () => {
  const generate = createSummaryGenerator({
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        output: [{ content: [{ type: 'output_text', text: JSON.stringify({
          summary: 'Use a short comparison when revisiting risk stratification.',
          focusConcepts: ['risk', 'invented'],
        }) }] }],
      }),
    }),
  });
  const result = await generate(states);
  assert.equal(result.source, 'llm');
  assert.deepEqual(result.focusConcepts, ['risk']);
});
