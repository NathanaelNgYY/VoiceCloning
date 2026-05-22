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
        aux_ref_audio_paths: ['training/datasets/obama/aux1.wav'],
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
    aux_ref_audio_paths: ['training/datasets/obama/aux1.wav'],
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
