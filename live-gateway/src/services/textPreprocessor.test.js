import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSentenceBoundaries, preprocessText } from './textPreprocessor.js';

test('ensureSentenceBoundaries inserts a boundary into a long run-on with no punctuation', () => {
  const input = 'i think the economy is doing great and we are winning so much right now that nobody can believe it';
  const result = ensureSentenceBoundaries(input);
  // A sentence-ending period was inserted somewhere
  assert.ok(result.includes('.'), `expected an inserted period, got: ${result}`);
  // It became more than one sentence
  assert.ok(result.split('.').filter((s) => s.trim()).length >= 2);
});

test('ensureSentenceBoundaries prefers splitting before a conjunction', () => {
  const input = 'we have the best people working on this every single day and they tell me the numbers are incredible';
  const result = ensureSentenceBoundaries(input);
  // The period lands right before "and"
  assert.match(result, /day\.\s+and/i);
});

test('ensureSentenceBoundaries leaves already-punctuated text unchanged', () => {
  const input = 'Hello there. How are you doing today? I am doing just fine, thanks.';
  assert.equal(ensureSentenceBoundaries(input), input);
});

test('ensureSentenceBoundaries leaves a short run-on below threshold unchanged', () => {
  const input = 'we are winning so much';
  assert.equal(ensureSentenceBoundaries(input), input);
});

test('ensureSentenceBoundaries leaves long comma/em-dash punctuated text unchanged', () => {
  const input = "It's known for its stunning skyline, super clean streets and a mix of cultures — Chinese, Malay, Indian, and more.";
  assert.equal(ensureSentenceBoundaries(input), input);
});

test('preprocessText splits intra-word hyphens so TTS does not say "minus"', () => {
  assert.equal(preprocessText('Michelin-starred restaurants'), 'Michelin starred restaurants');
  assert.equal(preprocessText('a vibrant city-state'), 'a vibrant city state');
});

test('preprocessText punctuates a run-on and still normalizes numbers', () => {
  const input = 'in 2021 we built so many things and people loved every single part of what we were doing together';
  const result = preprocessText(input);
  assert.ok(result.includes('.'), `expected punctuation, got: ${result}`);
  assert.match(result, /twenty twenty-one/);
});
