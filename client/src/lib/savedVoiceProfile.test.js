import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSavedVoiceProfileRestoreKey,
  findSavedVoiceProfileKey,
  hasRestorableSavedVoiceProfile,
  matchesSavedVoiceProfileReferenceSelection,
  matchesSavedVoiceProfileSelection,
} from './savedVoiceProfile.js';

test('matchesSavedVoiceProfileSelection requires the same voiceProfileId and model refs', () => {
  const profile = {
    voiceProfileId: 'lecturer-a-v1',
    gptKey: 'models/user-models/gpt/lecturer-a.ckpt',
    sovitsKey: 'models/user-models/sovits/lecturer-a.pth',
  };

  assert.equal(matchesSavedVoiceProfileSelection({
    profile,
    voiceProfileId: 'lecturer-a-v1',
    selectedGPT: 'models/user-models/gpt/lecturer-a.ckpt',
    selectedSoVITS: 'models/user-models/sovits/lecturer-a.pth',
  }), true);

  assert.equal(matchesSavedVoiceProfileSelection({
    profile,
    voiceProfileId: 'lecturer-a-v1',
    selectedGPT: 'models/user-models/gpt/other.ckpt',
    selectedSoVITS: 'models/user-models/sovits/lecturer-a.pth',
  }), false);

  assert.equal(matchesSavedVoiceProfileSelection({
    profile,
    voiceProfileId: 'other-v1',
    selectedGPT: 'models/user-models/gpt/lecturer-a.ckpt',
    selectedSoVITS: 'models/user-models/sovits/lecturer-a.pth',
  }), false);
});

test('buildSavedVoiceProfileRestoreKey changes when the saved reference set changes', () => {
  const base = buildSavedVoiceProfileRestoreKey({
    voiceProfileId: 'lecturer-a-v1',
    ref_audio_path: 'refs/primary.wav',
    aux_ref_audio_paths: ['refs/aux-1.wav'],
    updatedAt: '2026-06-03T00:00:00.000Z',
  });

  const changed = buildSavedVoiceProfileRestoreKey({
    voiceProfileId: 'lecturer-a-v1',
    ref_audio_path: 'refs/primary.wav',
    aux_ref_audio_paths: ['refs/aux-1.wav', 'refs/aux-2.wav'],
    updatedAt: '2026-06-03T00:00:00.000Z',
  });

  assert.notEqual(base, changed);
});

test('findSavedVoiceProfileKey maps a saved voiceProfileId back to the selectable profile key', () => {
  assert.equal(findSavedVoiceProfileKey([
    { key: 'lecturera', displayName: 'Lecturer A' },
    { key: 'lecturerb', displayName: 'Lecturer B' },
  ], 'lecturer-b-v1'), 'lecturerb');

  assert.equal(findSavedVoiceProfileKey([
    { key: 'lecturera', displayName: 'Lecturer A' },
  ], 'missing-v1'), '');
});

test('hasRestorableSavedVoiceProfile requires both a primary reference and at least five auxiliary references', () => {
  assert.equal(hasRestorableSavedVoiceProfile({
    ref_audio_path: 'refs/primary.wav',
    aux_ref_audio_paths: ['refs/aux-1.wav', 'refs/aux-2.wav', 'refs/aux-3.wav', 'refs/aux-4.wav', 'refs/aux-5.wav'],
  }), true);

  assert.equal(hasRestorableSavedVoiceProfile({
    ref_audio_path: 'refs/primary.wav',
    aux_ref_audio_paths: ['refs/aux-1.wav'],
  }), false);

  assert.equal(hasRestorableSavedVoiceProfile({
    ref_audio_path: 'refs/primary.wav',
    aux_ref_audio_paths: [],
  }), false);
});

test('matchesSavedVoiceProfileReferenceSelection requires the exact saved primary and auxiliary set', () => {
  const profile = {
    ref_audio_path: 'refs/primary.wav',
    aux_ref_audio_paths: ['refs/aux-1.wav', 'refs/aux-2.wav', 'refs/aux-3.wav', 'refs/aux-4.wav', 'refs/aux-5.wav'],
  };

  assert.equal(matchesSavedVoiceProfileReferenceSelection({
    profile,
    refAudioPath: 'refs/primary.wav',
    auxRefAudioPaths: ['refs/aux-1.wav', 'refs/aux-2.wav', 'refs/aux-3.wav', 'refs/aux-4.wav', 'refs/aux-5.wav'],
  }), true);

  assert.equal(matchesSavedVoiceProfileReferenceSelection({
    profile,
    refAudioPath: 'refs/primary.wav',
    auxRefAudioPaths: ['refs/aux-1.wav', 'refs/aux-2.wav', 'refs/aux-3.wav', 'refs/aux-4.wav'],
  }), false);

  assert.equal(matchesSavedVoiceProfileReferenceSelection({
    profile,
    refAudioPath: 'refs/other-primary.wav',
    auxRefAudioPaths: ['refs/aux-1.wav', 'refs/aux-2.wav', 'refs/aux-3.wav', 'refs/aux-4.wav', 'refs/aux-5.wav'],
  }), false);
});
