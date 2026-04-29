import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBestReferenceSet } from './referenceSelection.js';

test('chooseBestReferenceSet prefers clean transcript-rich wav files and adds auxiliaries', () => {
  const result = chooseBestReferenceSet([
    {
      filename: 'noisy_long_take.mp3',
      path: 'training/datasets/alex/denoised/noisy_long_take.mp3',
      transcript: 'This is a long noisy take with music behind it and lots of room sound.',
      lang: 'en',
    },
    {
      filename: 'clean_reference_02.wav',
      path: 'training/datasets/alex/denoised/clean_reference_02.wav',
      transcript: 'The quick brown fox jumps over the lazy dog.',
      lang: 'EN',
    },
    {
      filename: 'short.wav',
      path: 'training/datasets/alex/denoised/short.wav',
      transcript: 'Hi.',
      lang: 'en',
    },
    {
      filename: 'bright_best_aux.flac',
      path: 'training/datasets/alex/denoised/bright_best_aux.flac',
      transcript: 'Please keep this voice natural and steady for the assistant.',
      lang: 'en',
    },
  ]);

  assert.equal(result.primary.filename, 'clean_reference_02.wav');
  assert.deepEqual(result.aux.map((file) => file.filename), ['bright_best_aux.flac', 'short.wav']);
  assert.match(result.reason, /transcript/i);
});

test('chooseBestReferenceSet returns no primary for an empty audio list', () => {
  assert.deepEqual(chooseBestReferenceSet([]), {
    primary: null,
    aux: [],
    reason: 'No training audio clips are available.',
  });
});
