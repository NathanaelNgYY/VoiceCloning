import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseBestReferenceSet,
  describeReferenceCandidate,
  shouldAutoApplyBestReferenceSet,
} from './referenceSelection.js';

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

test('chooseBestReferenceSet hard-filters clips outside strict reference requirements before ranking', () => {
  const result = chooseBestReferenceSet([
    {
      filename: 'clean_reference_0_64000.wav',
      path: 'training/datasets/alex/denoised/clean_reference_0_64000.wav',
      transcript: 'This clip sounds fine but is too short.',
      lang: 'en',
    },
    {
      filename: 'clean_reference_0_160000.wav',
      path: 'training/datasets/alex/denoised/clean_reference_0_160000.wav',
      transcript: 'This clip has no sentence ending',
      lang: 'en',
    },
    {
      filename: 'noisy_reference_0_160000.wav',
      path: 'training/datasets/alex/denoised/noisy_reference_0_160000.wav',
      transcript: 'This clip ends properly.',
      lang: 'en',
    },
    {
      filename: 'steady_neutral_0_160000.wav',
      path: 'training/datasets/alex/denoised/steady_neutral_0_160000.wav',
      transcript: 'This clip is steady, clean, and complete.',
      lang: 'en',
    },
  ], { maxAux: 2 });

  assert.equal(result.primary.filename, 'steady_neutral_0_160000.wav');
  assert.deepEqual(result.aux, []);
  assert.equal(result.mode, 'strict');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.rejected.length, 3);
  assert.match(result.rejected[0].reasons.join(' '), /duration/i);
  assert.match(result.rejected[1].reasons.join(' '), /sentence/i);
  assert.match(result.rejected[2].reasons.join(' '), /risky/i);
});

test('chooseBestReferenceSet exposes score metadata for selected reference clips', () => {
  const result = chooseBestReferenceSet([
    {
      filename: 'steady_neutral_0_160000.wav',
      path: 'training/datasets/alex/denoised/steady_neutral_0_160000.wav',
      transcript: 'This clip is steady, clean, and complete.',
      lang: 'en',
    },
  ]);

  assert.equal(result.primaryMetadata.filename, 'steady_neutral_0_160000.wav');
  assert.equal(result.primaryMetadata.eligible, true);
  assert.equal(result.primaryMetadata.durationSeconds, 5);
  assert.equal(result.primaryMetadata.checks.idealDuration, true);
  assert.equal(result.primaryMetadata.checks.endsWithSentence, true);
  assert.ok(result.primaryMetadata.breakdown.duration > 0);
  assert.ok(result.primaryMetadata.breakdown.speakerConsistency > 0);
});

test('describeReferenceCandidate reports why a clip was rejected', () => {
  const candidate = describeReferenceCandidate({
    filename: 'bad_long_take_0_480000.wav',
    path: 'training/datasets/alex/denoised/bad_long_take_0_480000.wav',
    transcript: 'This is not stable enough',
    lang: 'en',
  });

  assert.equal(candidate.eligible, false);
  assert.deepEqual(candidate.reasons, [
    'Duration 15.0s is outside the strict 3-9s reference range.',
    'Transcript should end with sentence punctuation.',
    'Filename contains risky reference hints.',
  ]);
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

test('shouldAutoApplyBestReferenceSet waits for the selected voice clip list instead of using stale files', () => {
  assert.equal(
    shouldAutoApplyBestReferenceSet({
      selectedSourceKey: 'PMWongVoice',
      loadedSourceKey: 'LHLChinese',
      loading: false,
      fileCount: 6,
      lastAppliedSourceKey: '',
    }),
    false,
  );

  assert.equal(
    shouldAutoApplyBestReferenceSet({
      selectedSourceKey: 'PMWongVoice',
      loadedSourceKey: 'PMWongVoice',
      loading: false,
      fileCount: 6,
      lastAppliedSourceKey: '',
    }),
    true,
  );
});

test('chooseBestReferenceSet ranks by audio quality score when present', () => {
  const result = chooseBestReferenceSet([
    { filename: 'a_0_1.wav', path: 'd/a_0_1.wav', transcript: 'A clear sentence here for the reference.', lang: 'en', qualityScore: 40 },
    { filename: 'b_1_2.wav', path: 'd/b_1_2.wav', transcript: 'Another clear sentence here for reference.', lang: 'en', qualityScore: 85 },
    { filename: 'c_2_3.wav', path: 'd/c_2_3.wav', transcript: 'Yet another clear sentence for the reference.', lang: 'en', qualityScore: 60 },
  ], { maxAux: 2 });

  assert.equal(result.primary.filename, 'b_1_2.wav');
  assert.deepEqual(result.aux.map((file) => file.filename), ['c_2_3.wav', 'a_0_1.wav']);
  assert.match(result.reason, /quality/i);
});

test('chooseBestReferenceSet transcript guard avoids an empty-transcript primary', () => {
  const result = chooseBestReferenceSet([
    { filename: 'pristine_empty.wav', path: 'd/pristine_empty.wav', transcript: '', lang: 'en', qualityScore: 85 },
    { filename: 'good_text.wav', path: 'd/good_text.wav', transcript: 'This is a perfectly usable reference sentence for cloning.', lang: 'en', qualityScore: 75 },
  ], { maxAux: 1 });

  assert.equal(result.primary.filename, 'good_text.wav');
});
