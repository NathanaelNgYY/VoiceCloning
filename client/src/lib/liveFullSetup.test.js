import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIVE_FULL_SETTINGS,
  buildLiveFullConfigPayload,
  buildLiveFullRefParams,
  filterLiveFullConfigs,
  filterLiveFastConfigs,
  normalizeLiveFullSettings,
} from './liveFullSetup.js';

test('normalizeLiveFullSettings keeps system full inference defaults stable', () => {
  assert.deepEqual(normalizeLiveFullSettings({}), DEFAULT_LIVE_FULL_SETTINGS);
});

test('buildLiveFullRefParams uses full settings and selected references', () => {
  const params = buildLiveFullRefParams({
    primaryPath: 'training/runs/demo/ref.wav',
    promptText: 'Reference transcript',
    promptLang: 'en',
    auxRefAudios: [
      { path: 'training/runs/demo/aux-1.wav' },
      { path: 'training/runs/demo/aux-2.wav' },
    ],
    settings: {
      speed: 0.95,
      topK: 12,
      topP: 0.8,
      temperature: 0.55,
      repPenalty: 1.4,
      maxChunkWords: 40,
      maxSentencesPerChunk: 3,
    },
  });

  assert.deepEqual(params, {
    ref_audio_path: 'training/runs/demo/ref.wav',
    prompt_text: 'Reference transcript',
    prompt_lang: 'en',
    aux_ref_audio_paths: [
      'training/runs/demo/aux-1.wav',
      'training/runs/demo/aux-2.wav',
    ],
    speed_factor: 0.95,
    top_k: 12,
    top_p: 0.8,
    temperature: 0.55,
    repetition_penalty: 1.4,
    max_chunk_words: 40,
    max_sentences_per_chunk: 3,
  });
});

test('live full and live fast config filters keep saved lists isolated', () => {
  const configs = [
    { configId: 'default', inferenceMetadata: { preferredRoute: 'sentence' } },
    { configId: 'full-a', inferenceMetadata: { pipeline: 'liveFull' } },
    { configId: 'full-b', inferenceMetadata: { preferredRoute: 'full' } },
  ];

  assert.deepEqual(filterLiveFastConfigs(configs).map((item) => item.configId), ['default']);
  assert.deepEqual(filterLiveFullConfigs(configs).map((item) => item.configId), ['full-a', 'full-b']);
});

test('buildLiveFullConfigPayload marks configs as live full only', () => {
  const payload = buildLiveFullConfigPayload({
    configId: 'full-a',
    configName: 'Full A',
    rank: 2,
    language: 'en',
    settings: DEFAULT_LIVE_FULL_SETTINGS,
    trainingMetadata: { engineVersion: 'v2ProPlus' },
    referenceMetadata: {
      selectedPaths: {
        primary: 'training/runs/demo/ref.wav',
        aux: ['training/runs/demo/aux.wav'],
      },
    },
  });

  assert.equal(payload.configId, 'full-a');
  assert.equal(payload.inferenceMetadata.pipeline, 'liveFull');
  assert.equal(payload.inferenceMetadata.preferredRoute, 'full');
  assert.equal(payload.referenceMetadata.selectedPaths.primary, 'training/runs/demo/ref.wav');
});
