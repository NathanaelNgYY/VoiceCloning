import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTextForSynthesis } from './textPronunciation.js';

test('prepareTextForSynthesis normalizes symbols and dashes for any synthesis route', () => {
  const result = prepareTextForSynthesis('The free-energy change ΔG - or ∆G - is real-time.');

  assert.match(result, /delta\s+G/i);
  assert.doesNotMatch(result, /[Δ∆]/u);
  assert.doesNotMatch(result, /\s-\s/u);
  assert.doesNotMatch(result, /[–—]/u);
  assert.match(result, /real time/u);
});

test('prepareTextForSynthesis expands known compounds before synthesis', () => {
  const result = prepareTextForSynthesis('The biomolecule dataset supports healthcare workflows.');

  assert.match(result, /bio molecule/u);
  assert.match(result, /data set/u);
  assert.match(result, /health care/u);
  assert.match(result, /work flows/u);
});

test('prepareTextForSynthesis handles bullets, ranges, and math operators', () => {
  const result = prepareTextForSynthesis('• ATP 5-10 times higher -- e.g. ΔG≤0 and A+B.');

  assert.doesNotMatch(result, /•/u);
  assert.match(result, /5 to 10/u);
  assert.match(result, /for example/u);
  assert.match(result, /delta G\s+less than or equal to\s+0/u);
  assert.match(result, /A\+B|A B/u);
  assert.doesNotMatch(result, /--/u);
});

test('prepareTextForSynthesis expands slash abbreviations and removes spoken punctuation dashes', () => {
  const result = prepareTextForSynthesis('Use ref. w/ enzyme - not w/o ATP; input/output matters.');

  assert.match(result, /reference with enzyme, not without ATP/u);
  assert.match(result, /input or out put/u);
  assert.doesNotMatch(result, /[-–—]/u);
});

test('prepareTextForSynthesis expands numeric units, percents, and ordinals to words', () => {
  const result = prepareTextForSynthesis('Give 1 mg then 500 mg, up to 50% over the 1st and 2nd hour at 120 mmHg.');

  assert.match(result, /1 milligram\b/u);   // singular for exactly 1
  assert.match(result, /500 milligrams/u);  // plural otherwise
  assert.match(result, /50 percent/u);
  assert.match(result, /\bfirst\b/u);
  assert.match(result, /\bsecond\b/u);
  assert.match(result, /millimeters of mercury/u);
  assert.doesNotMatch(result, /%/u);
  assert.doesNotMatch(result, /\bmg\b/u);
});

test('prepareTextForSynthesis expands Roman numerals only after a classifier word', () => {
  const result = prepareTextForSynthesis('A stage IV tumor needs IV fluids.');

  assert.match(result, /stage 4/u);       // classified -> expanded
  assert.match(result, /\bIV fluids\b/u); // bare IV (intravenous) left intact
});
