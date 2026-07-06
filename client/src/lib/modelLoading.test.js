import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModelSelectWarmPayload,
  extractModelSelectWarmedReferenceSelection,
  isSelectedModelLoaded,
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

test('shouldLoadSelectedProfile does not reload when the worker reports the same weights at their downloaded location', () => {
  assert.equal(shouldLoadSelectedProfile({
    serverReady: true,
    selectedProfile: {
      complete: true,
      gptModel: { path: 'models/user-models/gpt/new.ckpt' },
      sovitsModel: { path: 'models/user-models/sovits/new.pth' },
    },
    loadedGPTPath: '/tmp/voice-cloning/model_cache/new.ckpt',
    loadedSoVITSPath: '/tmp/voice-cloning/model_cache/new.pth',
    isConversationActive: false,
    loadingModel: false,
  }), false);
});

test('isSelectedModelLoaded matches exact loaded paths (local mode)', () => {
  assert.equal(isSelectedModelLoaded({
    serverReady: true,
    selectedGPT: '/models/gpt/new.ckpt',
    selectedSoVITS: '/models/sovits/new.pth',
    loadedGPTPath: '/models/gpt/new.ckpt',
    loadedSoVITSPath: '/models/sovits/new.pth',
  }), true);
});

test('isSelectedModelLoaded treats the worker-local download of the selected S3 keys as loaded', () => {
  // S3 mode: the client selects S3 keys, but the worker reports the local file it
  // downloaded them to (model_cache/<basename of the key>). Same weights, different
  // location — the page must not fall back to "Loading the voice" over this.
  assert.equal(isSelectedModelLoaded({
    serverReady: true,
    selectedGPT: 'models/user-models/gpt/lecturer-e15.ckpt',
    selectedSoVITS: 'models/user-models/sovits/lecturer-e8.pth',
    loadedGPTPath: '/tmp/voice-cloning/model_cache/lecturer-e15.ckpt',
    loadedSoVITSPath: 'C:\\voice-cloning\\model_cache\\lecturer-e8.pth',
  }), true);
});

test('isSelectedModelLoaded is false when the server is not ready, paths are missing, or weights differ', () => {
  assert.equal(isSelectedModelLoaded({
    serverReady: false,
    selectedGPT: '/models/gpt/new.ckpt',
    selectedSoVITS: '/models/sovits/new.pth',
    loadedGPTPath: '/models/gpt/new.ckpt',
    loadedSoVITSPath: '/models/sovits/new.pth',
  }), false);

  assert.equal(isSelectedModelLoaded({
    serverReady: true,
    selectedGPT: '',
    selectedSoVITS: '',
    loadedGPTPath: '',
    loadedSoVITSPath: '',
  }), false);

  assert.equal(isSelectedModelLoaded({
    serverReady: true,
    selectedGPT: 'models/user-models/gpt/lecturer-e15.ckpt',
    selectedSoVITS: 'models/user-models/sovits/lecturer-e8.pth',
    loadedGPTPath: '/tmp/model_cache/other-voice-e15.ckpt',
    loadedSoVITSPath: '/tmp/model_cache/other-voice-e8.pth',
  }), false);

  assert.equal(isSelectedModelLoaded({
    serverReady: true,
    selectedGPT: 'models/user-models/gpt/lecturer-e15.ckpt',
    selectedSoVITS: 'models/user-models/sovits/lecturer-e8.pth',
    loadedGPTPath: '',
    loadedSoVITSPath: '',
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

  // Blank reported paths must preserve the last known-good model, not wipe it —
  // the server reports blanks for benign reasons and clearing caused false
  // "No model" flaps.
  assert.deepEqual(resolveInferenceStatusState({
    status: {
      ready: true,
      loaded: { gptPath: '', sovitsPath: '' },
    },
    fallbackLoadedGPTPath: 'models/gpt/current.ckpt',
    fallbackLoadedSoVITSPath: 'models/sovits/current.pth',
  }), {
    serverReady: true,
    loadedGPTPath: 'models/gpt/current.ckpt',
    loadedSoVITSPath: 'models/sovits/current.pth',
  });

  // Same model reported in a different path format (absolute vs S3 key) keeps the
  // canonical selection so "is my model loaded?" stays true.
  assert.deepEqual(resolveInferenceStatusState({
    status: {
      ready: true,
      loaded: {
        gptPath: '/opt/gpt-sovits/models/current.ckpt',
        sovitsPath: '/opt/gpt-sovits/models/current.pth',
      },
    },
    fallbackLoadedGPTPath: 'models/gpt/current.ckpt',
    fallbackLoadedSoVITSPath: 'models/sovits/current.pth',
  }), {
    serverReady: true,
    loadedGPTPath: 'models/gpt/current.ckpt',
    loadedSoVITSPath: 'models/sovits/current.pth',
  });

  // A genuine switch by another session (different, non-empty model) still takes effect.
  assert.deepEqual(resolveInferenceStatusState({
    status: {
      ready: true,
      loaded: { gptPath: 'models/gpt/other.ckpt', sovitsPath: 'models/sovits/other.pth' },
    },
    fallbackLoadedGPTPath: 'models/gpt/current.ckpt',
    fallbackLoadedSoVITSPath: 'models/sovits/current.pth',
  }), {
    serverReady: true,
    loadedGPTPath: 'models/gpt/other.ckpt',
    loadedSoVITSPath: 'models/sovits/other.pth',
  });
});
