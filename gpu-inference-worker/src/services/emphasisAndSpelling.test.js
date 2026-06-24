import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEmphasisAndSpelling, classifyWord } from './emphasisAndSpelling.js';

// Deterministic stubs so tests don't depend on a CMU file on disk.
const acronyms = new Set(['WHO']);
const realWords = new Set(['REALLY', 'STOP', 'WHO', 'IMPORTANT', 'ORDER', 'AN', 'NOW', 'THE', 'IS', 'THIS']);
const isRealWord = (w) => realWords.has(String(w).toUpperCase());
const opts = { acronyms, isRealWord };

test('dotted acronyms are spelled out', () => {
  const result = applyEmphasisAndSpelling('the W.H.O. guidelines', opts);
  assert.match(result, /W H O/u);
  assert.doesNotMatch(result, /W\.H\.O\./u);
});

test('space-separated single capitals are spelled out', () => {
  const result = applyEmphasisAndSpelling('order an E C G now', opts);
  assert.match(result, /E C G/u);
});

test('bare caps in the override list are spelled out', () => {
  const result = applyEmphasisAndSpelling('the WHO recommends', opts);
  assert.match(result, /W H O/u);
});

test('bare caps that are not real words are spelled out', () => {
  const result = applyEmphasisAndSpelling('order an ECG now', opts);
  assert.match(result, /E C G/u);
});

test('bare caps that are real words become emphasis (pause-bracketed, lowercased)', () => {
  const result = applyEmphasisAndSpelling('this is REALLY important', opts);
  assert.match(result, /,\s*really\s*,/u);
  assert.doesNotMatch(result, /REALLY/u);
});

test('lowercase words are left unchanged', () => {
  const result = applyEmphasisAndSpelling('who is the patient', opts);
  assert.equal(result, 'who is the patient');
});

test('lowercase abbreviations like e.g. are not spelled out', () => {
  const result = applyEmphasisAndSpelling('see e.g. the chart', opts);
  assert.match(result, /e\.g\./u);
});

test('a sentence mixing all cases', () => {
  const result = applyEmphasisAndSpelling('The WHO says this is REALLY urgent; order an ECG.', opts);
  assert.match(result, /W H O/u);
  assert.match(result, /,\s*really\s*,/u);
  assert.match(result, /E C G/u);
});

test('emphasis next to terminal punctuation does not leave a dangling comma', () => {
  const result = applyEmphasisAndSpelling('just STOP!', opts);
  assert.match(result, /stop!/u);
  assert.doesNotMatch(result, /,\s*!/u);
});

test('classifyWord distinguishes the three intents', () => {
  assert.equal(classifyWord('REALLY', opts), 'emphasis');
  assert.equal(classifyWord('ECG', opts), 'spellout');
  assert.equal(classifyWord('WHO', opts), 'spellout');
  assert.equal(classifyWord('who', opts), 'plain');
  assert.equal(classifyWord('A', opts), 'plain');
});
