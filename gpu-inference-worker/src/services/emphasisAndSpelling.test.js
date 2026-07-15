import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEmphasisAndSpelling, classifyWord } from './emphasisAndSpelling.js';

// Deterministic stubs so tests don't depend on a CMU file on disk.
const acronyms = new Set(['WHO']);
const realWords = new Set(['REALLY', 'STOP', 'GO', 'WHO', 'IMPORTANT', 'ORDER', 'AN', 'NOW', 'THE', 'IS', 'THIS', 'WAIT', 'SPEC', 'SAYS', 'URGENT']);
const isRealWord = (w) => realWords.has(String(w).toUpperCase());
const opts = { acronyms, isRealWord };

test('dotted acronyms are spelled out', () => {
  const result = applyEmphasisAndSpelling('the W.H.O. guidelines', opts);
  assert.equal(result, 'the W H O guidelines');
});

test('a dotted initialism preserves a period that also ends its sentence', () => {
  assert.equal(
    applyEmphasisAndSpelling('The F.A.D. Another sentence follows.', opts),
    'The F A D. Another sentence follows.',
  );
  assert.equal(applyEmphasisAndSpelling('The F.A.D.', opts), 'The F A D.');
});

test('space-separated single capitals are spelled out', () => {
  const result = applyEmphasisAndSpelling('order an E C G now', opts);
  assert.match(result, /E C G/u);
});

test('bare caps in the override list are spelled out', () => {
  const result = applyEmphasisAndSpelling('the WHO recommends', opts);
  assert.equal(result, 'the W H O recommends');
});

test('bare caps that are not real words are spelled out', () => {
  const result = applyEmphasisAndSpelling('order an ECG now', opts);
  assert.equal(result, 'order an E C G now');
});

test('bare caps that are real words become emphasis (pause-bracketed, lowercased)', () => {
  const result = applyEmphasisAndSpelling('this is REALLY important', opts);
  assert.equal(result, 'this is, really, important');
  assert.doesNotMatch(result, /REALLY/u);
});

test('lowercase words are left unchanged', () => {
  const result = applyEmphasisAndSpelling('who is the patient', opts);
  assert.equal(result, 'who is the patient');
});

test('lowercase abbreviations like e.g. are not spelled out', () => {
  const result = applyEmphasisAndSpelling('see e.g. the chart', opts);
  assert.equal(result, 'see e.g. the chart');
});

test('a sentence mixing all cases', () => {
  const result = applyEmphasisAndSpelling('The WHO says this is REALLY urgent; order an ECG.', opts);
  assert.match(result, /W H O/u);
  assert.match(result, /,\s*really\s*,/u);
  assert.match(result, /E C G/u);
  assert.doesNotMatch(result, /,,/u);
});

test('emphasis next to terminal punctuation does not leave a dangling comma', () => {
  const result = applyEmphasisAndSpelling('just STOP!', opts);
  assert.equal(result, 'just, stop!');
  assert.doesNotMatch(result, /,\s*!/u);
});

// --- Regression: sentence-boundary glue (CRITICAL 1) ---

test('emphasis after a sentence period keeps the space and does not glue words', () => {
  const result = applyEmphasisAndSpelling('Wait. STOP now.', opts);
  assert.equal(result, 'Wait. stop, now.');
  assert.doesNotMatch(result, /\.\S/u); // no letter glued directly after a period
});

test('two emphasis words across a period stay separated', () => {
  const result = applyEmphasisAndSpelling('STOP. GO.', opts);
  assert.equal(result, 'stop. go.');
});

test('emphasis at string start drops the leading comma', () => {
  const result = applyEmphasisAndSpelling('STOP now', opts);
  assert.equal(result, 'stop, now');
});

// --- Regression: doubled commas (CRITICAL 2) ---

test('adjacent emphasis words do not produce doubled commas', () => {
  const result = applyEmphasisAndSpelling('this is REALLY, REALLY important', opts);
  assert.doesNotMatch(result, /,,/u);
  assert.doesNotMatch(result, /,\s*,/u);
});

// --- Regression: alphanumeric tokens (IMPORTANT 3) ---

test('alphanumeric tokens are left untouched (no fused spell-out)', () => {
  assert.equal(applyEmphasisAndSpelling('HTML5 spec', opts), 'HTML5 spec');
  assert.equal(applyEmphasisAndSpelling('T2DM diagnosis', opts), 'T2DM diagnosis');
});

test('classifyWord distinguishes the three intents', () => {
  assert.equal(classifyWord('REALLY', opts), 'emphasis');
  assert.equal(classifyWord('ECG', opts), 'spellout');
  assert.equal(classifyWord('WHO', opts), 'spellout');
  assert.equal(classifyWord('who', opts), 'plain');
  assert.equal(classifyWord('A', opts), 'plain');
});

test('classifyWord leaves alphanumeric tokens plain', () => {
  assert.equal(classifyWord('HTML5', opts), 'plain');
  assert.equal(classifyWord('T2DM', opts), 'plain');
});
