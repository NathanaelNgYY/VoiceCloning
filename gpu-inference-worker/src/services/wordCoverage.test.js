import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWordCoverage, findClippedWords, isWordSpokenByTiming } from './wordCoverage.js';

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

test('number words and digits are treated as the same word (nine vs 9)', () => {
  const r = computeWordCoverage(
    'arranged themselves repeatedly nine times',
    'arranged themselves repeatedly 9 times',
  );
  assert.equal(r.coverage, 1, JSON.stringify(r));
  assert.deepEqual(r.missingWords, []);
});

test('one and a half matches Whisper decimal form 1.5', () => {
  const r = computeWordCoverage(
    'they double every one and a half to three hours while bacteria divide every twenty minutes',
    'they double every 1.5 to 3 hours while bacteria divide every 20 minutes',
  );

  assert.equal(r.coverage, 1, JSON.stringify(r));
  assert.deepEqual(r.missingWords, []);
});

test('US/UK spelling variants are treated as the same word (fibers vs fibres)', () => {
  const r = computeWordCoverage(
    'held at their position by interconnecting fibers',
    'held at their position by interconnecting fibres',
  );
  assert.equal(r.coverage, 1, JSON.stringify(r));
  const r2 = computeWordCoverage('the organizing center', 'the organising centre');
  assert.equal(r2.coverage, 1, JSON.stringify(r2));
});

test('a genuinely dropped medical word is still caught after normalization', () => {
  const r = computeWordCoverage(
    'two centrioles are known',
    'two centrals are known', // model really said the wrong word
  );
  assert.ok(r.coverage < 1, JSON.stringify(r));
  assert.ok(r.missingWords.includes('centrioles'), JSON.stringify(r));
});

test('low-confidence and short-span words are ADVISORY only (no hard re-roll)', () => {
  // Whisper word-boundary timing is imprecise, so a complete-but-brisk or low-
  // confidence word must NOT force a re-roll — only feed scoring. (Real drops are
  // caught by near-zero span and by the coverage / substantial-missing check.)
  const lowConf = findClippedWords('the mother centriole', [
    word('the', 0.2), word('mother', 0.5), word('centriole', 0.5, 0.1), // real audio, low conf
  ]);
  assert.ok(!lowConf.skippedWords.includes('centriole'), 'low-confidence word is not a hard skip');
  assert.ok(lowConf.suspectWords.includes('centriole'), 'but still scored (advisory)');

  const shortSpan = findClippedWords('the nerve cells fire', [
    word('the', 0.2), word('nerve', 0.4), word('cells', 0.08), word('fire', 0.3), // brisk, real audio
  ]);
  assert.ok(!shortSpan.skippedWords.includes('cells'), 'short-but-present word is not a hard skip');
});

test('only a near-zero audio span is a hard skip', () => {
  const { skippedWords } = findClippedWords('the nerve cells fire', [
    word('the', 0.2), word('nerve', 0.4), word('cells', 0.01), word('fire', 0.3), // 10ms = no real audio
  ]);
  assert.ok(skippedWords.includes('cells'), JSON.stringify(skippedWords));
});

test('a HALF-CUT word (short audio AND low confidence together) is a hard skip', () => {
  // "microtubules" given 0.2s (too short for 12 chars) AND low confidence (0.1) =
  // the model said part of it then cut, and Whisper is unsure. Must re-roll.
  const cut = findClippedWords('barrels of nine triplet microtubules', [
    word('barrels', 0.5), word('of', 0.2), word('nine', 0.3), word('triplet', 0.5), word('microtubules', 0.2, 0.1),
  ]);
  assert.ok(cut.skippedWords.includes('microtubules'), JSON.stringify(cut));

  // Same short span but CONFIDENT (brisk complete word) -> NOT a hard skip.
  const brisk = findClippedWords('barrels of nine triplet microtubules', [
    word('barrels', 0.5), word('of', 0.2), word('nine', 0.3), word('triplet', 0.5), word('microtubules', 0.2, 0.97),
  ]);
  assert.ok(!brisk.skippedWords.includes('microtubules'), JSON.stringify(brisk));
});

test('four-letter content words are scrutinized for half-cuts', () => {
  const cut = findClippedWords('divide very fast and unregulated', [
    word('divide', 0.4), word('very', 0.08, 0.1), word('fast', 0.08, 0.1), word('and', 0.2), word('unregulated', 0.7),
  ]);

  assert.ok(cut.skippedWords.includes('very'), JSON.stringify(cut));
  assert.ok(cut.skippedWords.includes('fast'), JSON.stringify(cut));
});

test('numeric units require a real word span', () => {
  const weak = findClippedWords('to three hours while bacteria divide every twenty minutes', [
    word('to', 0.12), word('3', 0.14), word('hours', 0.09, 0.95), word('while', 0.25),
    word('bacteria', 0.5), word('divide', 0.4), word('every', 0.25), word('20', 0.16), word('minutes', 0.28),
  ]);
  assert.ok(weak.skippedWords.includes('hours'), JSON.stringify(weak));

  const clean = findClippedWords('to three hours while bacteria divide every twenty minutes', [
    word('to', 0.12), word('3', 0.14), word('hours', 0.24, 0.95), word('while', 0.25),
    word('bacteria', 0.5), word('divide', 0.4), word('every', 0.25), word('20', 0.16), word('minutes', 0.28),
  ]);
  assert.ok(!clean.skippedWords.includes('hours'), JSON.stringify(clean));
});

test('numeric units with low confidence force a re-roll', () => {
  const cut = findClippedWords('divide every twenty minutes', [
    word('divide', 0.4), word('every', 0.25), word('20', 0.16), word('minutes', 0.3, 0.5),
  ]);

  assert.ok(cut.skippedWords.includes('minutes'), JSON.stringify(cut));
});

test('the final word before a full stop is re-rolled when clipped even at moderate confidence', () => {
  // Chunk-final word cut early by the AR decoder: short absolute span (<120ms) is a
  // hard skip at the tail even when Whisper completes it confidently from context.
  const cut = findClippedWords('the tumour was benign', [
    word('the', 0.15), word('tumour', 0.4), word('was', 0.2), word('benign', 0.1, 0.9),
  ]);
  assert.ok(cut.skippedWords.includes('benign'), JSON.stringify(cut));

  // Relaxed short+unsure pair: per-char span tiny AND confidence merely middling.
  const cut2 = findClippedWords('confirm the diagnosis', [
    word('confirm', 0.5), word('the', 0.15), word('diagnosis', 0.32, 0.55),
  ]);
  assert.ok(cut2.skippedWords.includes('diagnosis'), JSON.stringify(cut2));
});

test('a complete final word is NOT re-rolled by the tail check', () => {
  const clean = findClippedWords('the tumour was benign', [
    word('the', 0.15), word('tumour', 0.4), word('was', 0.2), word('benign', 0.42, 0.95),
  ]);
  assert.ok(!clean.skippedWords.includes('benign'), JSON.stringify(clean));
});

test('isWordSpokenByTiming confirms a word backed by real audio at its position', () => {
  const text = 'alpha beta gamma delta epsilon centriole eta theta iota kappa';
  // 10 heard words, all with a substantial span; the centriole position is spoken.
  const words = 'alpha beta gamma delta epsilon central eta theta iota kappa'
    .split(' ')
    .map((wd, i) => ({ w: wd, start: i, end: i + (i === 5 ? 0.3 : 0.25) }));
  assert.equal(isWordSpokenByTiming(text, 'centriole', words), true);
});

test('isWordSpokenByTiming rejects a word whose position has only near-zero spans', () => {
  const text = 'alpha beta gamma delta epsilon centriole eta theta iota kappa';
  // Around the centriole position every span is near-zero — a skip Whisper filled in
  // from context. The count may look fine, but timing proves it was not spoken.
  const words = 'alpha beta gamma delta epsilon central eta theta iota kappa'
    .split(' ')
    .map((wd, i) => ({ w: wd, start: i, end: i + (i >= 3 && i <= 7 ? 0.01 : 0.25) }));
  assert.equal(isWordSpokenByTiming(text, 'centriole', words), false);
});
