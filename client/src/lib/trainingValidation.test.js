import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTrainingStart } from './trainingValidation.js';

const wavFile = { name: 'voice_sample.wav', type: 'audio/wav', size: 8 * 1024 * 1024 };
const validEmail = 'alice.tan@ntu.edu.sg';

test('validateTrainingStart accepts an NTU address with supported audio and bounded settings', () => {
  const result = validateTrainingStart({
    email: validEmail,
    source: 'direct',
    files: [wavFile],
    batchSize: 2,
    sovitsEpochs: 20,
    gptEpochs: 25,
    sovitsSaveEvery: 4,
    gptSaveEvery: 5,
    asrLanguage: 'en',
  });

  assert.deepEqual(result, {
    valid: true,
    errors: [],
    email: 'alice.tan@ntu.edu.sg',
    baseVoiceName: 'alice-tan',
  });
});

test('validateTrainingStart canonicalises the email so one mailbox is one lecturer', () => {
  const result = validateTrainingStart({
    email: '  ALICE.TAN+lecture@staff.main.ntu.edu.sg ',
    source: 'direct',
    files: [wavFile],
  });

  assert.equal(result.valid, true);
  assert.equal(result.email, 'alice.tan+lecture@staff.main.ntu.edu.sg');
  assert.equal(result.baseVoiceName, 'alice-tan');
});

test('validateTrainingStart routes the dean to his already-deployed voice', () => {
  const result = validateTrainingStart({
    email: 'josephsung@ntu.edu.sg',
    source: 'direct',
    files: [wavFile],
  });

  assert.equal(result.baseVoiceName, 'DeanVoice');
});

test('validateTrainingStart rejects non-NTU and malformed addresses', () => {
  assert.deepEqual(validateTrainingStart({ email: 'user@example.com', source: 'direct', files: [wavFile] }).errors, [
    'Use your NTU email address (an @ntu.edu.sg address).',
  ]);
  assert.deepEqual(validateTrainingStart({ email: 'notanemail', source: 'direct', files: [wavFile] }).errors, [
    'Enter a valid email address.',
  ]);
  assert.deepEqual(validateTrainingStart({ email: '', source: 'direct', files: [wavFile] }).errors, [
    'Enter your NTU email address.',
  ]);
});

test('validateTrainingStart yields no voice name when the email is rejected', () => {
  const result = validateTrainingStart({ email: 'user@example.com', source: 'direct', files: [wavFile] });
  assert.equal(result.valid, false);
  assert.equal(result.baseVoiceName, '');
});

test('validateTrainingStart rejects empty or unsupported training audio input', () => {
  assert.deepEqual(validateTrainingStart({ email: validEmail, source: 'direct', files: [] }).errors, [
    'Upload at least one training audio file.',
  ]);

  assert.deepEqual(validateTrainingStart({
    email: validEmail,
    source: 'direct',
    files: [{ name: 'notes.txt', type: 'text/plain', size: 100 }],
  }).errors, [
    'Unsupported audio file: notes.txt. Use WAV, FLAC, MP3, M4A, OGG, WEBM, or MP4.',
  ]);
});

test('validateTrainingStart rejects out-of-range training settings', () => {
  const result = validateTrainingStart({
    email: validEmail,
    source: 'direct',
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

test('validateTrainingStart accepts shared-library mode with selected library files and no direct uploads', () => {
  const result = validateTrainingStart({
    email: validEmail,
    source: 'library',
    files: [],
    selectedLibraryIds: ['lib-1', 'lib-2'],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateTrainingStart rejects shared-library mode when no library files are selected', () => {
  const result = validateTrainingStart({
    email: validEmail,
    source: 'library',
    files: [],
    selectedLibraryIds: [],
  });

  assert.deepEqual(result.errors, ['Select at least one shared storage audio file.']);
});
