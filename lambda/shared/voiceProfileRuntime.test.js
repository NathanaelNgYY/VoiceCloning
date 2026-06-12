import test from 'node:test';
import assert from 'node:assert/strict';

import { createVoiceProfileResolver } from './voiceProfileRuntime.js';

function bufferJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf-8');
}

test('voice profile resolver loads a saved profile by voiceProfileId for synthesis', async () => {
  const loadedProfiles = [];
  const resolve = createVoiceProfileResolver({
    readObject: async (key) => {
      assert.equal(key, 'voice-profiles/lecturer-a-v1.json');
      return bufferJson({
        voiceProfileId: 'lecturer-a-v1',
        displayName: 'Lecturer A',
        gptKey: 'models/user-models/gpt/lecturer-a.ckpt',
        sovitsKey: 'models/user-models/sovits/lecturer-a.pth',
        ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
        prompt_text: 'Reference transcript',
        prompt_lang: 'en',
        text_lang: 'en',
        preferredRoute: 'sentence',
        aux_ref_audio_paths: [
          'training/datasets/lecturer-a/aux1.wav',
          'training/datasets/lecturer-a/aux2.wav',
          'training/datasets/lecturer-a/aux3.wav',
          'training/datasets/lecturer-a/aux4.wav',
          'training/datasets/lecturer-a/aux5.wav',
        ],
        defaults: {
          top_k: 7,
          top_p: 0.9,
          temperature: 0.65,
          repetition_penalty: 1.2,
          speed_factor: 1.05,
        },
      });
    },
    ensureModelsLoaded: async (profile) => {
      loadedProfiles.push(profile.voiceProfileId);
    },
  });

  const resolved = await resolve({
    text: 'Hello from the clinical chatbot.',
    voiceProfileId: 'lecturer-a-v1',
  });

  assert.deepEqual(loadedProfiles, ['lecturer-a-v1']);
  assert.deepEqual(resolved, {
    text: 'Hello from the clinical chatbot.',
    voiceProfileId: 'lecturer-a-v1',
    ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
    prompt_text: 'Reference transcript',
    prompt_lang: 'en',
    text_lang: 'en',
    aux_ref_audio_paths: [
      'training/datasets/lecturer-a/aux1.wav',
      'training/datasets/lecturer-a/aux2.wav',
      'training/datasets/lecturer-a/aux3.wav',
      'training/datasets/lecturer-a/aux4.wav',
      'training/datasets/lecturer-a/aux5.wav',
    ],
    top_k: 7,
    top_p: 0.9,
    temperature: 0.65,
    repetition_penalty: 1.2,
    speed_factor: 1.05,
  });
});

test('voice profile resolver falls back to the active saved profile when no voiceProfileId or ref audio is provided', async () => {
  const loadedProfiles = [];
  const resolve = createVoiceProfileResolver({
    readObject: async (key) => {
      assert.equal(key, 'voice-profiles/active.json');
      return bufferJson({
        voiceProfileId: 'obama-v1',
        displayName: 'Obama',
        gptKey: 'models/user-models/gpt/obama.ckpt',
        sovitsKey: 'models/user-models/sovits/obama.pth',
        ref_audio_path: 'training/datasets/obama/reference.wav',
        prompt_text: 'Saved active prompt',
        prompt_lang: 'en',
        text_lang: 'en',
        preferredRoute: 'sentence',
        aux_ref_audio_paths: [
          'training/datasets/obama/aux1.wav',
          'training/datasets/obama/aux2.wav',
          'training/datasets/obama/aux3.wav',
          'training/datasets/obama/aux4.wav',
          'training/datasets/obama/aux5.wav',
        ],
        defaults: {
          top_k: 5,
          top_p: 0.85,
          temperature: 0.7,
          repetition_penalty: 1.35,
          speed_factor: 1.0,
        },
      });
    },
    ensureModelsLoaded: async (profile) => {
      loadedProfiles.push(profile.voiceProfileId);
    },
  });

  const resolved = await resolve({
    text: 'Use the active saved voice.',
  });

  assert.deepEqual(loadedProfiles, ['obama-v1']);
  assert.deepEqual(resolved, {
    text: 'Use the active saved voice.',
    voiceProfileId: 'obama-v1',
    ref_audio_path: 'training/datasets/obama/reference.wav',
    prompt_text: 'Saved active prompt',
    prompt_lang: 'en',
    text_lang: 'en',
    aux_ref_audio_paths: [
      'training/datasets/obama/aux1.wav',
      'training/datasets/obama/aux2.wav',
      'training/datasets/obama/aux3.wav',
      'training/datasets/obama/aux4.wav',
      'training/datasets/obama/aux5.wav',
    ],
    top_k: 5,
    top_p: 0.85,
    temperature: 0.7,
    repetition_penalty: 1.35,
    speed_factor: 1.0,
  });
});

test('voice profile resolver rejects unknown voiceProfileId values', async () => {
  const resolve = createVoiceProfileResolver({
    readObject: async (key) => {
      assert.equal(key, 'voice-profiles/missing-v1.json');
      return null;
    },
    ensureModelsLoaded: async () => {
      throw new Error('should not load models');
    },
  });

  await assert.rejects(
    () => resolve({
      text: 'Hello',
      voiceProfileId: 'missing-v1',
    }),
    /Voice profile missing-v1 not found/u,
  );
});

test('voice profile resolver auto-selects primary and aux when the saved profile has fewer than five auxiliary references', async () => {
  const loadedProfiles = [];
  const listedExpNames = [];
  const readKeys = [];
  const writes = [];
  const resolve = createVoiceProfileResolver({
    readObject: async (key) => {
      readKeys.push(key);
      if (key === 'voice-profiles/lecturer-a-v1.json') {
        return bufferJson({
          voiceProfileId: 'lecturer-a-v1',
          displayName: 'Lecturer A',
          gptKey: 'models/user-models/gpt/lecturer-a-e25.ckpt',
          sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
          ref_audio_path: 'training/datasets/lecturer-a/manual-primary.wav',
          prompt_text: 'Manual prompt',
          prompt_lang: 'en',
          text_lang: 'en',
          preferredRoute: 'sentence',
          aux_ref_audio_paths: ['training/datasets/lecturer-a/manual-aux-1.wav'],
          defaults: {
            top_k: 7,
            top_p: 0.9,
            temperature: 0.65,
            repetition_penalty: 1.2,
            speed_factor: 1.05,
          },
        });
      }
      if (key === 'voice-profiles/active.json') {
        return bufferJson({
          voiceProfileId: 'lecturer-a-v1',
          displayName: 'Lecturer A',
          gptKey: 'models/user-models/gpt/lecturer-a-e25.ckpt',
          sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
          ref_audio_path: 'training/datasets/lecturer-a/manual-primary.wav',
          prompt_text: 'Manual prompt',
          prompt_lang: 'en',
          text_lang: 'en',
          preferredRoute: 'sentence',
          aux_ref_audio_paths: ['training/datasets/lecturer-a/manual-aux-1.wav'],
          defaults: {
            top_k: 7,
            top_p: 0.9,
            temperature: 0.65,
            repetition_penalty: 1.2,
            speed_factor: 1.05,
          },
          activatedAt: '2026-06-03T08:00:00.000Z',
        });
      }
      return null;
    },
    writeObject: async (key, buffer) => {
      writes.push({ key, body: JSON.parse(buffer.toString('utf-8')) });
    },
    ensureModelsLoaded: async (profile) => {
      loadedProfiles.push(profile);
    },
    listTrainingAudioFiles: async (expName) => {
      listedExpNames.push(expName);
      return [
        {
          filename: 'lecturer-a_reference.wav',
          path: 'training/datasets/lecturer-a/lecturer-a_reference.wav',
          transcript: 'This is the balanced reference clip for the lecturer voice.',
          lang: 'en',
        },
        {
          filename: 'lecturer-a_support.wav',
          path: 'training/datasets/lecturer-a/lecturer-a_support.wav',
          transcript: 'This support clip keeps the voice steady for synthesis.',
          lang: 'en',
        },
      ];
    },
  });

  const resolved = await resolve({
    text: 'Use the strengthened saved profile behavior.',
    voiceProfileId: 'lecturer-a-v1',
  });

  assert.deepEqual(readKeys, ['voice-profiles/lecturer-a-v1.json', 'voice-profiles/active.json']);
  assert.deepEqual(listedExpNames, ['lecturer-a']);
  assert.equal(writes.length, 3);
  assert.deepEqual(writes[0], {
    key: 'voice-profiles/lecturer-a-v1.json',
    body: {
      voiceProfileId: 'lecturer-a-v1',
      displayName: 'Lecturer A',
      gptKey: 'models/user-models/gpt/lecturer-a-e25.ckpt',
      sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
      ref_audio_path: 'training/datasets/lecturer-a/lecturer-a_reference.wav',
      prompt_text: 'Manual prompt',
      prompt_lang: 'en',
      text_lang: 'en',
      preferredRoute: 'sentence',
      aux_ref_audio_paths: ['training/datasets/lecturer-a/lecturer-a_support.wav'],
      defaults: {
        top_k: 7,
        top_p: 0.9,
        temperature: 0.65,
        repetition_penalty: 1.2,
        speed_factor: 1.05,
      },
      updatedAt: writes[0].body.updatedAt,
    },
  });
  assert.deepEqual(writes[1], {
    key: 'voice-profiles/active.json',
    body: {
      voiceProfileId: 'lecturer-a-v1',
      displayName: 'Lecturer A',
      gptKey: 'models/user-models/gpt/lecturer-a-e25.ckpt',
      sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
      ref_audio_path: 'training/datasets/lecturer-a/lecturer-a_reference.wav',
      prompt_text: 'Manual prompt',
      prompt_lang: 'en',
      text_lang: 'en',
      preferredRoute: 'sentence',
      aux_ref_audio_paths: ['training/datasets/lecturer-a/lecturer-a_support.wav'],
      defaults: {
        top_k: 7,
        top_p: 0.9,
        temperature: 0.65,
        repetition_penalty: 1.2,
        speed_factor: 1.05,
      },
      activatedAt: '2026-06-03T08:00:00.000Z',
      updatedAt: writes[1].body.updatedAt,
    },
  });
  assert.equal(writes[2].key, 'voice-profile-configs/lecturer-a-v1/default.json');
  assert.equal(writes[2].body.configId, 'default');
  assert.equal(writes[2].body.rank, 1);
  assert.equal(writes[2].body.referenceMetadata.selectedPaths.primary, 'training/datasets/lecturer-a/lecturer-a_reference.wav');
  assert.deepEqual(writes[2].body.referenceMetadata.selectedPaths.aux, ['training/datasets/lecturer-a/lecturer-a_support.wav']);
  assert.equal(loadedProfiles.length, 1);
  assert.deepEqual(loadedProfiles[0].aux_ref_audio_paths, ['training/datasets/lecturer-a/lecturer-a_support.wav']);
  assert.equal(loadedProfiles[0].ref_audio_path, 'training/datasets/lecturer-a/lecturer-a_reference.wav');
  assert.deepEqual(resolved, {
    text: 'Use the strengthened saved profile behavior.',
    voiceProfileId: 'lecturer-a-v1',
    ref_audio_path: 'training/datasets/lecturer-a/lecturer-a_reference.wav',
    prompt_text: 'Manual prompt',
    prompt_lang: 'en',
    text_lang: 'en',
    aux_ref_audio_paths: ['training/datasets/lecturer-a/lecturer-a_support.wav'],
    top_k: 7,
    top_p: 0.9,
    temperature: 0.65,
    repetition_penalty: 1.2,
    speed_factor: 1.05,
  });
});
