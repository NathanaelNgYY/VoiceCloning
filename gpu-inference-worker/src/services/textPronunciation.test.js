import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareTextForFullSynthesis,
  prepareTextForSynthesis,
} from './textPronunciation.js';

test('prepareTextForSynthesis normalizes symbols and dashes for any synthesis route', () => {
  const result = prepareTextForSynthesis('The free-energy change ΔG - or ∆G - is real-time.');

  assert.match(result, /delta\s+gee/i);
  assert.doesNotMatch(result, /[Δ∆]/u);
  assert.doesNotMatch(result, /\s-\s/u);
  assert.doesNotMatch(result, /[–—]/u);
  assert.match(result, /real time/u);
});

test('prepareTextForSynthesis spells lone capital letters as letter names, leaving A and I alone', () => {
  assert.equal(prepareTextForSynthesis('ΔG and ΔH and ΔS'), 'delta gee and delta aitch and delta ess');
  // "A" (article) and "I" (pronoun) must survive untouched.
  assert.equal(prepareTextForSynthesis('A patient told I would recover'), 'A patient told I would recover');
});

test('prepareTextForSynthesis gives explicit initialisms deterministic letter names', () => {
  assert.equal(prepareTextForSynthesis('F A D'), 'eff ay dee');
  assert.equal(prepareTextForSynthesis('A I'), 'ay eye');
  assert.equal(prepareTextForSynthesis('A patient told I would recover'), 'A patient told I would recover');
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
  assert.match(result, /delta gee\s+less than or equal to\s+0/u);
  assert.match(result, /A\+bee|A B/u);
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

test('Live Full groups each formula symbol naturally with its subscript', () => {
  const result = prepareTextForFullSynthesis(
    'Glucose is C6H12O6, peroxide is H2O2, carbohydrates approximate (CH2O)n, and the carboxyl group is COOH.',
  );

  assert.match(result, /see six, aitch twelve, oh six/u);
  assert.match(result, /aitch two, oh two/u);
  assert.match(result, /open parenthesis, see, aitch two, oh, close parenthesis, en/u);
  assert.match(result, /see oh oh aitch/u);
  assert.doesNotMatch(result, /\bcee\b/u);
  assert.doesNotMatch(result, /C6H12O6|H2O2|\(CH2O\)n|COOH/u);
});

test('Live Full recognizes element-symbol casing without treating normal capitals as formulas', () => {
  const result = prepareTextForFullSynthesis('NaCl dissolves in H2O and Fe2O3 is solid, but ATP and NASA stay ordinary tokens.');

  assert.match(result, /en ay see el/u);
  assert.match(result, /aitch two, oh/u);
  assert.match(result, /eff ee two, oh three/u);
  assert.match(result, /\bATP\b/u);
  assert.match(result, /\bNASA\b/u);
});

test('Live Full speaks larger subscripts and numeric group counts without changing invalid symbols', () => {
  const result = prepareTextForFullSynthesis('C20H101O1000 and (CH2O)6 are formulas; Xx2 is not.');

  assert.match(result, /see twenty, aitch one hundred one, oh one zero zero zero/u);
  assert.match(result, /open parenthesis, see, aitch two, oh, close parenthesis, six/u);
  assert.match(result, /\bXx2\b/u);
});

test('shared normalization keeps compact formulas unchanged for Live Fast', () => {
  const result = prepareTextForSynthesis('C6H12O6 and (CH2O)n');

  assert.equal(result, 'C6H12O6 and (CH2O)n');
});
