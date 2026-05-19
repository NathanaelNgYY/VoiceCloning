import test from 'node:test';
import assert from 'node:assert/strict';

import { buildVoiceProfileId, buildVoiceProfilePayload } from './voiceProfilePayload.js';

test('buildVoiceProfileId creates a stable v1 slug from the display name', () => {
  assert.equal(buildVoiceProfileId('Michael Tan'), 'michael-tan-v1');
  assert.equal(buildVoiceProfileId(' Dr  Lim '), 'dr-lim-v1');
});

test('buildVoiceProfilePayload uses S3 model keys and preserves reference settings', () => {
  assert.deepEqual(
    buildVoiceProfilePayload({
      displayName: 'Michael Tan',
      selectedGPT: 'models/user-models/gpt/michael-tan.ckpt',
      selectedSoVITS: 'models/user-models/sovits/michael-tan.pth',
      refAudioPath: 'training/datasets/michael-tan/reference.wav',
      promptText: 'Reference transcript',
      promptLang: 'en',
      textLang: 'en',
      preferredRoute: 'sentence',
      auxRefAudioPaths: ['training/datasets/michael-tan/aux1.wav'],
      defaults: {
        top_k: 5,
        top_p: 0.85,
        temperature: 0.7,
        repetition_penalty: 1.35,
        speed_factor: 1.0,
      },
      storageMode: 's3',
    }),
    {
      voiceProfileId: 'michael-tan-v1',
      displayName: 'Michael Tan',
      gptKey: 'models/user-models/gpt/michael-tan.ckpt',
      sovitsKey: 'models/user-models/sovits/michael-tan.pth',
      ref_audio_path: 'training/datasets/michael-tan/reference.wav',
      prompt_text: 'Reference transcript',
      prompt_lang: 'en',
      text_lang: 'en',
      preferredRoute: 'sentence',
      aux_ref_audio_paths: ['training/datasets/michael-tan/aux1.wav'],
      defaults: {
        top_k: 5,
        top_p: 0.85,
        temperature: 0.7,
        repetition_penalty: 1.35,
        speed_factor: 1.0,
      },
    },
  );
});

test('buildVoiceProfilePayload uses local paths outside S3 mode', () => {
  assert.deepEqual(
    buildVoiceProfilePayload({
      voiceProfileId: 'custom-voice-v2',
      displayName: 'Custom Voice',
      selectedGPT: 'C:/models/custom.ckpt',
      selectedSoVITS: 'C:/models/custom.pth',
      refAudioPath: 'C:/refs/reference.wav',
      promptText: '',
      promptLang: 'en',
      textLang: 'zh',
      preferredRoute: 'full',
      auxRefAudioPaths: [],
      defaults: {
        top_k: 8,
        top_p: 0.8,
        temperature: 0.6,
        repetition_penalty: 1.2,
        speed_factor: 0.9,
      },
      storageMode: 'local',
    }),
    {
      voiceProfileId: 'custom-voice-v2',
      displayName: 'Custom Voice',
      gptPath: 'C:/models/custom.ckpt',
      sovitsPath: 'C:/models/custom.pth',
      ref_audio_path: 'C:/refs/reference.wav',
      prompt_text: '',
      prompt_lang: 'en',
      text_lang: 'zh',
      preferredRoute: 'full',
      aux_ref_audio_paths: [],
      defaults: {
        top_k: 8,
        top_p: 0.8,
        temperature: 0.6,
        repetition_penalty: 1.2,
        speed_factor: 0.9,
      },
    },
  );
});
