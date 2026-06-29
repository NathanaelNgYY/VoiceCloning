import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWordCoverage } from './wordCoverage.js';

test('full match yields coverage 1 and no missing words', () => {
  const result = computeWordCoverage(
    'The patient was given antibiotics twice daily.',
    'the patient was given antibiotics twice daily',
  );
  assert.equal(result.coverage, 1);
  assert.deepEqual(result.missingWords, []);
});

test('a dropped word lowers coverage and is reported', () => {
  const result = computeWordCoverage(
    'Take two tablets after every meal.',
    'take two tablets after meal', // "every" skipped
  );
  assert.ok(result.coverage < 1);
  assert.ok(result.missingWords.includes('every'));
});

test('a cut-off sentence tail is caught as missing words', () => {
  const result = computeWordCoverage(
    'Administer the medication slowly to avoid an adverse reaction.',
    'administer the medication slowly', // tail dropped
  );
  assert.ok(result.coverage < 0.6);
  assert.ok(result.missingWords.includes('adverse'));
  assert.ok(result.missingWords.includes('reaction'));
});

test('minor ASR misspelling of a long word still counts as covered', () => {
  const result = computeWordCoverage('acetaminophen dosage', 'acetaminaphen dosage');
  assert.equal(result.coverage, 1);
});

test('pure numerals and single letters are not held against the read', () => {
  // "19" spelled out by ASR and a spelled-out acronym letter should not register
  // as drops; the real word "patient" still must be present.
  const result = computeWordCoverage('COVID 19 patient', 'covid nineteen patient');
  assert.equal(result.missingWords.length, 0);
  assert.equal(result.coverage, 1);
});

test('empty expected text is fully covered', () => {
  const result = computeWordCoverage('', 'anything at all');
  assert.equal(result.coverage, 1);
  assert.equal(result.expectedCount, 0);
});

test('repeated expected word needs two occurrences in transcript', () => {
  const partial = computeWordCoverage('very very mild', 'very mild');
  assert.ok(partial.coverage < 1);
  assert.equal(partial.missingWords.filter((w) => w === 'very').length, 1);

  const full = computeWordCoverage('very very mild', 'very very mild');
  assert.equal(full.coverage, 1);
});
