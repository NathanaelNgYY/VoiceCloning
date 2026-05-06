import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTrainingStart } from './trainingValidation.js';

const wavFile = { name: 'voice_sample.wav', type: 'audio/wav', size: 8 * 1024 * 1024 };

test('validateTrainingStart accepts a named run with supported audio and bounded settings', () => {
  const result = validateTrainingStart({
    expName: 'demo_voice_01',
    files: [wavFile],
    batchSize: 2,
    sovitsEpochs: 20,
    gptEpochs: 25,
    sovitsSaveEvery: 4,
    gptSaveEvery: 5,
    asrLanguage: 'en',
  });

  assert.deepEqual(result, { valid: true, errors: [] });
});

test('validateTrainingStart rejects missing or unsafe experiment names before upload', () => {
  assert.deepEqual(validateTrainingStart({ expName: '', files: [wavFile] }), {
    valid: false,
    errors: ['Enter an experiment name.'],
  });

  assert.deepEqual(validateTrainingStart({ expName: '../voice', files: [wavFile] }), {
    valid: false,
    errors: ['Experiment name may only contain letters, numbers, dots, dashes, and underscores.'],
  });
});

test('validateTrainingStart rejects empty or unsupported training audio input', () => {
  assert.deepEqual(validateTrainingStart({ expName: 'voice', files: [] }), {
    valid: false,
    errors: ['Upload at least one training audio file.'],
  });

  assert.deepEqual(validateTrainingStart({
    expName: 'voice',
    files: [{ name: 'notes.txt', type: 'text/plain', size: 100 }],
  }), {
    valid: false,
    errors: ['Unsupported audio file: notes.txt. Use WAV, FLAC, MP3, M4A, OGG, WEBM, or MP4.'],
  });
});

test('validateTrainingStart rejects out-of-range training settings', () => {
  const result = validateTrainingStart({
    expName: 'voice',
    files: [wavFile],
    batchSize: 0,
    sovitsEpochs: 0,
    gptEpochs: 51,
    sovitsSaveEvery: 11,
    gptSaveEvery: 0,
    asrLanguage: 'pirate',
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    'Batch size must be between 1 and 4.',
    'SoVITS epochs must be between 1 and 50.',
    'GPT epochs must be between 1 and 50.',
    'SoVITS save interval must be between 1 and 10.',
    'GPT save interval must be between 1 and 10.',
    'ASR language must be English, Chinese, Japanese, Korean, or Auto Detect.',
  ]);
});
