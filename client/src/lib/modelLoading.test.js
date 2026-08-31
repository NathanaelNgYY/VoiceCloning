import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModelSelectWarmPayload,
  extractModelSelectWarmedReferenceSelection,
  resolveWarmedReferencePrompt,
  isSelectedModelLoaded,
  canPinVoicePerRequest,
  isVoiceReadyToSynthesize,
  resolveInferenceStatusState,
  sameLoadedWeights,
  shouldHoldReadyDuringTransientStatus,
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

test('buildModelSelectWarmPayload can refresh a system-managed auto reference set', () => {
  assert.deepEqual(buildModelSelectWarmPayload({
    voiceProfileId: 'lecturer-a-v1',
    refreshAutoReferences: true,
  }), {
    voiceProfileId: 'lecturer-a-v1',
    refresh_auto_references: true,
  });
});

test('extractModelSelectWarmedReferenceSelection normalizes the warmed reference set returned by model loading', () => {
  assert.deepEqual(extractModelSelectWarmedReferenceSelection({
    warmedReferences: {
      ref_audio_path: 'refs/primary.wav',
      prompt_text: '  Correct transcript.  ',
      prompt_lang: 'EN',
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
    promptText: 'Correct transcript.',
    promptLang: 'EN',
  });

  assert.equal(extractModelSelectWarmedReferenceSelection({
    warmedReferences: {
      ref_audio_path: '',
      aux_ref_audio_paths: ['refs/aux-1.wav'],
    },
  }), null);
});

test('buildModelSelectWarmPayload can make a dropdown selection metadata-only', () => {
  assert.deepEqual(buildModelSelectWarmPayload({
    voiceProfileId: 'lecturer-a-v1',
    prepareCapacity: false,
  }), {
    voiceProfileId: 'lecturer-a-v1',
    prepareCapacity: false,
  });
});

test('metadata-only model selection returns resolved references without claiming they were warmed', () => {
  assert.deepEqual(extractModelSelectWarmedReferenceSelection({
    selectionOnly: true,
    resolvedReferences: {
      ref_audio_path: 'refs/dean.wav',
      aux_ref_audio_paths: ['refs/dean.wav', 'refs/dean-aux.wav'],
      prompt_text: 'Dean reference transcript.',
      prompt_lang: 'en',
    },
  }), {
    refAudioPath: 'refs/dean.wav',
    auxRefAudioPaths: ['refs/dean-aux.wav'],
    promptText: 'Dean reference transcript.',
    promptLang: 'en',
  });
});

test('warmed reference prompt never follows a stale active profile from another primary clip', () => {
  assert.deepEqual(resolveWarmedReferencePrompt({
    refAudioPath: 'refs/new-primary.wav',
    promptText: 'Correct transcript for the new clip.',
    promptLang: 'EN',
  }, {
    path: 'refs/new-primary.wav',
    transcript: 'Manifest transcript fallback.',
    lang: 'en',
  }, {
    ref_audio_path: 'refs/old-primary.wav',
    prompt_text: 'Stale transcript from the old clip.',
    prompt_lang: 'en',
  }), {
    promptText: 'Correct transcript for the new clip.',
    promptLang: 'EN',
  });
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

test('one transient not-ready status does not flash a loaded model as missing', () => {
  const nextState = { serverReady: false, loadedGPTPath: 'gpt.ckpt', loadedSoVITSPath: 'sovits.pth' };
  assert.equal(shouldHoldReadyDuringTransientStatus({
    nextState,
    previousServerReady: true,
    hasKnownLoadedModel: true,
    consecutiveNotReady: 1,
  }), true);
  assert.equal(shouldHoldReadyDuringTransientStatus({
    nextState,
    previousServerReady: true,
    hasKnownLoadedModel: true,
    consecutiveNotReady: 2,
  }), false);
});

// The inference worker's per-conversation voice isolation caches weights as
// `<basename>-<12 hex digest><ext>` (gpu-inference-worker requestVoiceModel.js),
// so the path it reports as loaded no longer equals the S3 key's basename. These
// are the real filenames observed on the staging fleet; before the digest was
// tolerated the page never saw its own model as loaded and looped forever on
// "Loading the voice — this may take a moment."
test('sameLoadedWeights matches an S3 key against the worker digest-suffixed cache file', () => {
  assert.equal(sameLoadedWeights(
    'models/user-models/gpt/DeanVoice-e25.ckpt',
    '/opt/gpt-sovits/worker_temp/model_cache/DeanVoice-e25-1203a84d89c6.ckpt',
  ), true);

  assert.equal(sameLoadedWeights(
    'models/user-models/sovits/DeanVoice_e20_s2260.pth',
    '/opt/gpt-sovits/worker_temp/model_cache/DeanVoice_e20_s2260-77cb04370df3.pth',
  ), true);
});

test('sameLoadedWeights still distinguishes different models sharing a digest shape', () => {
  assert.equal(sameLoadedWeights(
    'models/user-models/gpt/DeanVoice-e25.ckpt',
    '/opt/gpt-sovits/worker_temp/model_cache/DeanVoice-e20-1203a84d89c6.ckpt',
  ), false);

  assert.equal(sameLoadedWeights(
    'models/user-models/gpt/Deanv2-e25.ckpt',
    '/opt/gpt-sovits/worker_temp/model_cache/DeanVoice-e25-1203a84d89c6.ckpt',
  ), false);
});

test('sameLoadedWeights does not strip a suffix that is not a 12-char hex digest', () => {
  // `-e20_s2260` and friends are real model-name segments, not cache digests.
  assert.equal(sameLoadedWeights(
    'models/user-models/gpt/Voice-notahexdigest.ckpt',
    '/cache/Voice.ckpt',
  ), false);
});

test('isSelectedModelLoaded reports ready once the digest suffix is accounted for', () => {
  assert.equal(isSelectedModelLoaded({
    serverReady: true,
    selectedGPT: 'models/user-models/gpt/DeanVoice-e25.ckpt',
    selectedSoVITS: 'models/user-models/sovits/DeanVoice_e20_s2260.pth',
    loadedGPTPath: '/opt/gpt-sovits/worker_temp/model_cache/DeanVoice-e25-1203a84d89c6.ckpt',
    loadedSoVITSPath: '/opt/gpt-sovits/worker_temp/model_cache/DeanVoice_e20_s2260-77cb04370df3.pth',
  }), true);
});

// Regression: two sites sharing one inference backend must both stay usable.
// Each page used to auto-load its own voice onto the shared GPU and then gate
// readiness on /inference/status, so whichever page lost the race sat on
// "Loading the voice — this may take a moment." for good.

test('canPinVoicePerRequest needs the profile id and both halves of the weight pair', () => {
  const full = { voiceProfileId: 'dr-lim', selectedGPT: 'gpt.ckpt', selectedSoVITS: 'sovits.pth' };
  assert.equal(canPinVoicePerRequest(full), true);
  assert.equal(canPinVoicePerRequest({ ...full, selectedGPT: '' }), false);
  assert.equal(canPinVoicePerRequest({ ...full, selectedSoVITS: '   ' }), false);
  assert.equal(canPinVoicePerRequest({ ...full, voiceProfileId: '' }), false);
  assert.equal(canPinVoicePerRequest({}), false);
});

test('a pinned voice is ready even while the shared GPU holds another site\'s model', () => {
  assert.equal(isVoiceReadyToSynthesize({
    usingStandardVoice: false,
    serverReady: true,
    selectedModelLoaded: false,   // /inference/status reports the other site's voice
    pinsOwnWeights: true,
    resolvesPerRequest: false,
    hasReferenceParams: true,
  }), true);
});

test('a pinned voice still waits for its reference clip', () => {
  assert.equal(isVoiceReadyToSynthesize({
    usingStandardVoice: false,
    serverReady: true,
    selectedModelLoaded: false,
    pinsOwnWeights: true,
    resolvesPerRequest: false,
    hasReferenceParams: false,
  }), false);
});

test('pinning does not paper over a backend that is not up', () => {
  assert.equal(isVoiceReadyToSynthesize({
    usingStandardVoice: false,
    serverReady: false,
    selectedModelLoaded: false,
    pinsOwnWeights: true,
    resolvesPerRequest: false,
    hasReferenceParams: true,
  }), false);
});

test('a saved profile resolves its own references, so it needs none from the page', () => {
  assert.equal(isVoiceReadyToSynthesize({
    usingStandardVoice: false,
    serverReady: true,
    selectedModelLoaded: false,
    pinsOwnWeights: false,
    resolvesPerRequest: true,
    hasReferenceParams: false,
  }), true);
});

test('an already-loaded model stays ready without pinning, GPU state unread', () => {
  assert.equal(isVoiceReadyToSynthesize({
    usingStandardVoice: false,
    serverReady: false,
    selectedModelLoaded: true,
    pinsOwnWeights: false,
    resolvesPerRequest: false,
    hasReferenceParams: true,
  }), true);
});

test('a stock voice is ready with no weights, references or backend at all', () => {
  assert.equal(isVoiceReadyToSynthesize({
    usingStandardVoice: true,
    serverReady: false,
    selectedModelLoaded: false,
    pinsOwnWeights: false,
    resolvesPerRequest: false,
    hasReferenceParams: false,
  }), true);
});

test('nothing selected is not ready', () => {
  assert.equal(isVoiceReadyToSynthesize({
    usingStandardVoice: false,
    serverReady: true,
    selectedModelLoaded: false,
    pinsOwnWeights: false,
    resolvesPerRequest: false,
    hasReferenceParams: false,
  }), false);
});
