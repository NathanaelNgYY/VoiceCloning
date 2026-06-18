import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTextForSynthesis } from './textPronunciation.js';

test('prepareTextForSynthesis normalizes symbols and dashes for any synthesis route', () => {
  const result = prepareTextForSynthesis('The free-energy change ΔG - or ∆G - is real-time.');

  assert.match(result, /delta\s+G/i);
  assert.doesNotMatch(result, /[Δ∆]/u);
  assert.doesNotMatch(result, /\s-\s/u);
  assert.match(result, /—/u);
  assert.match(result, /real time/u);
});

test('prepareTextForSynthesis expands known compounds before synthesis', () => {
  const result = prepareTextForSynthesis('The biomolecule dataset supports healthcare workflows.');

  assert.match(result, /bio molecule/u);
  assert.match(result, /data set/u);
  assert.match(result, /health care/u);
  assert.match(result, /work flows/u);
});
