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
  ], { maxAux: 2 });

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

test('chooseBestReferenceSet chooses five auxiliary clips by default', () => {
  const files = [
    {
      filename: 'clean_reference.wav',
      path: 'training/datasets/alex/denoised/clean_reference.wav',
      transcript: 'The quick brown fox jumps over the lazy dog.',
      lang: 'en',
    },
    ...Array.from({ length: 7 }, (_, index) => ({
      filename: `steady_aux_${index + 1}.wav`,
      path: `training/datasets/alex/denoised/steady_aux_${index + 1}.wav`,
      transcript: `This is auxiliary reference clip number ${index + 1}.`,
      lang: 'en',
    })),
  ];

  const result = chooseBestReferenceSet(files);

  assert.equal(result.primary.filename, 'clean_reference.wav');
  assert.equal(result.aux.length, 5);
});

test('chooseBestReferenceSet prefers a fuller prompt over a tiny intro clip', () => {
  const result = chooseBestReferenceSet([
    {
      filename: 'a_intro.wav',
      path: 'training/datasets/alex/denoised/a_intro.wav',
      transcript: 'My fellow Singaporeans',
      lang: 'en',
    },
    {
      filename: 'b_balanced.wav',
      path: 'training/datasets/alex/denoised/b_balanced.wav',
      transcript: 'The morning air was calm and clear as people gathered outside.',
      lang: 'en',
    },
  ], { maxAux: 2 });

  assert.equal(result.primary.filename, 'b_balanced.wav');
});
