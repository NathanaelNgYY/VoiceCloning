import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIVE_FAST_SETTINGS,
  buildLiveFastRefParams,
  normalizeLiveFastSettings,
} from './liveFastSetup.js';

test('normalizeLiveFastSettings keeps inference defaults stable', () => {
  assert.deepEqual(normalizeLiveFastSettings({}), DEFAULT_LIVE_FAST_SETTINGS);
});

test('normalizeLiveFastSettings bounds user-editable inference controls', () => {
  assert.deepEqual(normalizeLiveFastSettings({
    speed: 3,
    topK: 0,
    topP: 2,
    temperature: -1,
    repPenalty: 5,
  }), DEFAULT_LIVE_FAST_SETTINGS);
});

test('buildLiveFastRefParams uses trained primary, five aux clips, and inference controls', () => {
  const params = buildLiveFastRefParams({
    primaryPath: 'training/datasets/alex/denoised/ref.wav',
    promptText: 'Reference words',
    promptLang: 'en',
    auxRefAudios: Array.from({ length: 7 }, (_, index) => ({
      path: `training/datasets/alex/denoised/aux_${index + 1}.wav`,
    })),
    settings: {
      speed: 0.9,
      topK: 8,
      topP: 0.8,
      temperature: 0.6,
      repPenalty: 1.25,
    },
  });

  assert.deepEqual(params, {
    ref_audio_path: 'training/datasets/alex/denoised/ref.wav',
    prompt_text: 'Reference words',
    prompt_lang: 'en',
    aux_ref_audio_paths: [
      'training/datasets/alex/denoised/aux_1.wav',
      'training/datasets/alex/denoised/aux_2.wav',
      'training/datasets/alex/denoised/aux_3.wav',
      'training/datasets/alex/denoised/aux_4.wav',
      'training/datasets/alex/denoised/aux_5.wav',
    ],
    speed_factor: 0.9,
    top_k: 8,
    top_p: 0.8,
    temperature: 0.6,
    repetition_penalty: 1.25,
  });
});
