import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModelSelectWarmPayload,
  extractModelSelectWarmedReferenceSelection,
  resolveInferenceStatusState,
  shouldLoadSelectedProfile,
} from './modelLoading.js';

const profile = {
  complete: true,
  gptModel: { path: '/models/gpt/new.ckpt' },
  sovitsModel: { path: '/models/sovits/new.pth' },
};

test('shouldLoadSelectedProfile loads a different selected complete model immediately', () => {
  assert.equal(shouldLoadSelectedProfile({
    serverReady: true,
    selectedProfile: profile,
    loadedGPTPath: '/models/gpt/old.ckpt',
    loadedSoVITSPath: '/models/sovits/old.pth',
    isConversationActive: false,
    loadingModel: false,
  }), true);
});

test('shouldLoadSelectedProfile can load even before the inference server reports ready', () => {
  assert.equal(shouldLoadSelectedProfile({
    serverReady: false,
    selectedProfile: profile,
    loadedGPTPath: '',
    loadedSoVITSPath: '',
    isConversationActive: false,
    loadingModel: false,
  }), true);
});

test('shouldLoadSelectedProfile does not reload the already loaded profile', () => {
  assert.equal(shouldLoadSelectedProfile({
    serverReady: true,
    selectedProfile: profile,
    loadedGPTPath: '/models/gpt/new.ckpt',
    loadedSoVITSPath: '/models/sovits/new.pth',
    isConversationActive: false,
    loadingModel: false,
  }), false);
});

test('shouldLoadSelectedProfile waits while conversation or loading is active', () => {
  assert.equal(shouldLoadSelectedProfile({
    serverReady: true,
    selectedProfile: profile,
    loadedGPTPath: '/models/gpt/old.ckpt',
    loadedSoVITSPath: '/models/sovits/old.pth',
    isConversationActive: true,
    loadingModel: false,
  }), false);

  assert.equal(shouldLoadSelectedProfile({
    serverReady: true,
    selectedProfile: profile,
    loadedGPTPath: '/models/gpt/old.ckpt',
    loadedSoVITSPath: '/models/sovits/old.pth',
    isConversationActive: false,
    loadingModel: true,
  }), false);
});

test('buildModelSelectWarmPayload omits ref warming when no primary ref is selected', () => {
  assert.deepEqual(buildModelSelectWarmPayload(), {});
  assert.deepEqual(buildModelSelectWarmPayload({
    refAudioPath: '',
    auxRefAudioPaths: ['refs/aux.wav'],
  }), {});
});

test('buildModelSelectWarmPayload forwards primary and capped auxiliary ref paths', () => {
  assert.deepEqual(buildModelSelectWarmPayload({
    refAudioPath: 'refs/primary.wav',
    auxRefAudioPaths: [
      'refs/aux-1.wav',
      '',
      'refs/aux-2.wav',
      'refs/aux-3.wav',
      'refs/aux-4.wav',
      'refs/aux-5.wav',
      'refs/aux-6.wav',
    ],
  }), {
    ref_audio_path: 'refs/primary.wav',
    aux_ref_audio_paths: [
      'refs/aux-1.wav',
      'refs/aux-2.wav',
      'refs/aux-3.wav',
      'refs/aux-4.wav',
      'refs/aux-5.wav',
    ],
  });
});

test('buildModelSelectWarmPayload forwards voiceProfileId when model loading should reuse a saved profile', () => {
  assert.deepEqual(buildModelSelectWarmPayload({
    voiceProfileId: 'lecturer-a-v1',
  }), {
    voiceProfileId: 'lecturer-a-v1',
  });

  assert.deepEqual(buildModelSelectWarmPayload({
    voiceProfileId: 'lecturer-a-v1',
    refAudioPath: 'refs/primary.wav',
    auxRefAudioPaths: ['refs/aux-1.wav'],
  }), {
    voiceProfileId: 'lecturer-a-v1',
    ref_audio_path: 'refs/primary.wav',
    aux_ref_audio_paths: ['refs/aux-1.wav'],
  });
});

test('extractModelSelectWarmedReferenceSelection normalizes the warmed reference set returned by model loading', () => {
  assert.deepEqual(extractModelSelectWarmedReferenceSelection({
    warmedReferences: {
      ref_audio_path: 'refs/primary.wav',
      aux_ref_audio_paths: [
        'refs/aux-1.wav',
        '',
        'refs/primary.wav',
        'refs/aux-2.wav',
        'refs/aux-3.wav',
        'refs/aux-4.wav',
        'refs/aux-5.wav',
        'refs/aux-6.wav',
      ],
    },
  }), {
    refAudioPath: 'refs/primary.wav',
    auxRefAudioPaths: [
      'refs/aux-1.wav',
      'refs/aux-2.wav',
      'refs/aux-3.wav',
      'refs/aux-4.wav',
      'refs/aux-5.wav',
    ],
  });

  assert.equal(extractModelSelectWarmedReferenceSelection({
    warmedReferences: {
      ref_audio_path: '',
      aux_ref_audio_paths: ['refs/aux-1.wav'],
    },
  }), null);
});

test('resolveInferenceStatusState preserves the last known loaded weights when status omits loaded paths', () => {
  assert.deepEqual(resolveInferenceStatusState({
    status: { ready: false, workerAvailable: false },
    fallbackLoadedGPTPath: 'models/gpt/current.ckpt',
    fallbackLoadedSoVITSPath: 'models/sovits/current.pth',
  }), {
    serverReady: false,
    loadedGPTPath: 'models/gpt/current.ckpt',
    loadedSoVITSPath: 'models/sovits/current.pth',
  });

  assert.deepEqual(resolveInferenceStatusState({
    status: {
      ready: true,
      loaded: { gptPath: '', sovitsPath: '' },
    },
    fallbackLoadedGPTPath: 'models/gpt/current.ckpt',
    fallbackLoadedSoVITSPath: 'models/sovits/current.pth',
  }), {
    serverReady: true,
    loadedGPTPath: '',
    loadedSoVITSPath: '',
  });
});
