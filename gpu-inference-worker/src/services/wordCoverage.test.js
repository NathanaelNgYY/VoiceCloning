import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWordCoverage, findClippedWords, findDuplicatedWords } from './wordCoverage.js';

// Helper: build a Whisper-style word entry.
function word(w, durationSec, probability = 0.95) {
  return { w, start: 0, end: durationSec, p: probability };
}

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

test('dictionary-split words match the single word Whisper actually wrote', () => {
  // The pronunciation dictionary splits hard terms ("endoscopy" -> "endos copy")
  // to force pronunciation; Whisper transcribes the real single word. These must
  // NOT read as skipped.
  const result = computeWordCoverage(
    'gastroen terologic endos copy was performed',
    'gastroenterologic endoscopy was performed',
  );
  assert.equal(result.coverage, 1);
  assert.deepEqual(result.missingWords, []);
});

test('codes and numbers are not held against the read', () => {
  // "ClinicalTrials.gov number NCT01675856" — Whisper can't transcribe the code;
  // only the real words "clinical"/"trials"/"number" should be required.
  const result = computeWordCoverage(
    'clinicaltrials gov number NCT01675856',
    'clinical trials number n c t',
  );
  // "clinicaltrials" matches via the space-stripped transcript ("clinicaltrials"),
  // "number" matches directly; "gov" and the code are not counted.
  assert.ok(result.coverage >= 0.5);
  assert.ok(!result.missingWords.includes('nct01675856'));
});

test('findClippedWords flags a long word with an implausibly short span', () => {
  // "acetaminophen" (13 chars) given only 0.2s of audio = clearly clipped, even
  // though Whisper transcribed it in full with high confidence.
  const { suspectWords } = findClippedWords('the acetaminophen dosage', [
    word('the', 0.15), word('acetaminophen', 0.2, 0.97), word('dosage', 0.4),
  ]);
  assert.deepEqual(suspectWords, ['acetaminophen']);
});

test('findClippedWords flags a low-confidence long word', () => {
  const { suspectWords } = findClippedWords('administer epinephrine now', [
    word('administer', 0.7), word('epinephrine', 0.7, 0.15), word('now', 0.3),
  ]);
  assert.deepEqual(suspectWords, ['epinephrine']);
});

test('findClippedWords does not flag a fully, confidently spoken word', () => {
  const { suspectWords } = findClippedWords('the acetaminophen dosage', [
    word('the', 0.15), word('acetaminophen', 0.95, 0.97), word('dosage', 0.4),
  ]);
  assert.deepEqual(suspectWords, []);
});

test('findClippedWords ignores short words on confidence/timing noise', () => {
  // Realistic short-word durations (~0.12s) with low confidence must NOT flag —
  // confidence/per-char timing are too noisy to judge short words.
  const { suspectWords } = findClippedWords('it is on', [
    word('it', 0.12, 0.2), word('is', 0.11, 0.2), word('on', 0.13, 0.2),
  ]);
  assert.deepEqual(suspectWords, []);
});

test('findClippedWords flags a skipped short word (near-zero spoken span)', () => {
  // A hallucinated skip: Whisper wrote "is" but gave it a 10ms span — no real
  // audio under it. This is the case coverage can't see, so it must be flagged.
  const { suspectWords } = findClippedWords('it is on', [
    word('it', 0.12, 0.95), word('is', 0.01, 0.95), word('on', 0.13, 0.95),
  ]);
  assert.deepEqual(suspectWords, ['is']);
});

test('findClippedWords returns nothing without word timing data', () => {
  const { suspectWords } = findClippedWords('acetaminophen dosage', []);
  assert.deepEqual(suspectWords, []);
});

test('repeated expected word needs two occurrences in transcript', () => {
  const partial = computeWordCoverage('very very mild', 'very mild');
  assert.ok(partial.coverage < 1);
  assert.equal(partial.missingWords.filter((w) => w === 'very').length, 1);

  const full = computeWordCoverage('very very mild', 'very very mild');
  assert.equal(full.coverage, 1);
});

test('findDuplicatedWords flags a stuttered content word ("barrels of barrels")', () => {
  const { duplicatedWords } = findDuplicatedWords(
    'Each centriole is made up of barrels of nine triplet microtubules',
    'Each central is made up of barrels of barrels',
  );
  assert.deepEqual(duplicatedWords, ['barrels']);
});

test('findDuplicatedWords ignores a clean take and legitimately repeated words', () => {
  assert.equal(
    findDuplicatedWords('mother centriole and daughter centriole', 'mother centriole and daughter centriole')
      .duplicatedWords.length,
    0,
  );
  // short function words duplicated by ASR noise are not flagged
  assert.equal(
    findDuplicatedWords('made up of barrels', 'made up of of barrels').duplicatedWords.length,
    0,
  );
});
