import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptionVerifier } from '../services/transcriptionVerifier.js';
import { speakerSimilarity } from '../services/speakerSimilarity.js';
import { inferenceState } from '../services/inferenceState.js';

async function loadInferenceRouteModule() {
  try {
    return await import('./inference.js');
  } catch (error) {
    assert.fail(`Expected gpu-inference-worker inference route module to load: ${error.message}`);
  }
}

test('handleLiveTtsRequest synthesizes immediately without a readiness probe', async () => {
  const module = await loadInferenceRouteModule();
  assert.equal(typeof module.handleLiveTtsRequest, 'function');

  let synthesizeCalls = 0;
  let resolveCalls = 0;

  const result = await module.handleLiveTtsRequest({
    text: 'The free-energy change ΔG - or ∆G - matters.',
    ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
    aux_ref_audio_paths: [],
  }, {
    resolveParams: async (body) => {
      resolveCalls += 1;
      return {
        ...body,
        ref_audio_path: '/tmp/reference.wav',
      };
    },
    synthesize: async (params) => {
      synthesizeCalls += 1;
      assert.equal(params.ref_audio_path, '/tmp/reference.wav');
      assert.match(params.text, /delta\s+G/i);
      assert.doesNotMatch(params.text, /[Δ∆]/u);
      assert.doesNotMatch(params.text, /\s-\s/u);
      return Buffer.from('RIFFdemo');
    },
  });

  assert.equal(resolveCalls, 1);
  assert.equal(synthesizeCalls, 1);
  assert.equal(result.audioBuffer.toString('utf-8'), 'RIFFdemo');
});

test('Live Full keeps ASR validation when speaker verification is unavailable', async () => {
  const module = await loadInferenceRouteModule();
  mock.method(transcriptionVerifier, 'verifyChunk', async () => ({
    ok: true,
    coverage: 1,
    missingWords: [],
    extraWords: [],
    suspectWords: [],
    skippedWords: [],
    words: [],
    transcript: 'A complete sentence.',
  }));
  mock.method(speakerSimilarity, 'scoreChunk', async () => null);
  try {
    const verifyChunk = module.verificationOptions(
      { ref_audio_path: '/tmp/reference.wav' },
      { finalWordTailCheck: true },
    ).verifyChunk;
    const result = await verifyChunk(Buffer.from('RIFFdemo'), 'A complete sentence.');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.coverage, 1);
    assert.equal(result.speakerVerificationUnavailable, true);
  } finally {
    mock.restoreAll();
  }
});

test('Live Fast enables phoneme verification without enabling Full tail checks', async () => {
  const module = await loadInferenceRouteModule();
  let receivedOptions = null;
  mock.method(transcriptionVerifier, 'verifyChunk', async (_audio, _text, options) => {
    receivedOptions = options;
    return {
      ok: true,
      coverage: 1,
      missingWords: [],
      extraWords: [],
      suspectWords: [],
      skippedWords: [],
      words: [],
      transcript: 'A complete sentence.',
    };
  });
  try {
    const verifyChunk = module.verificationOptions(
      {},
      { phonemeVerification: true },
    ).verifyChunk;
    await verifyChunk(Buffer.from('RIFFdemo'), 'A complete sentence.');
    assert.equal(receivedOptions.phonemeVerification, true);
    assert.equal(receivedOptions.finalWordTailCheck, false);
  } finally {
    mock.restoreAll();
  }
});

test('stale inference progress does not report another user when no session owns synthesis', async () => {
  const module = await loadInferenceRouteModule();
  inferenceState.resetForNewSession({ sessionId: 'stale-session', params: {} });
  try {
    assert.equal(inferenceState.getState().status, 'waiting');
    assert.equal(module.synthesisBusy(), false);
  } finally {
    inferenceState.setError('cleared test state', 'cancelled');
  }
});

test('handleLiveTtsRequest re-seeds a rejected take and accepts the next clean one', async () => {
  const module = await loadInferenceRouteModule();

  let synthCalls = 0;
  let verifyCalls = 0;
  const seeds = [];
  const result = await module.handleLiveTtsRequest({
    text: 'Order the test now.',
    ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
    aux_ref_audio_paths: [],
  }, {
    resolveParams: async (body) => ({ ...body, ref_audio_path: '/tmp/reference.wav' }),
    synthesize: async (params) => {
      synthCalls += 1;
      seeds.push(params.seed);
      return Buffer.from(`RIFF-take-${synthCalls}`);
    },
    // Reject the first take (dropped a word), accept the second.
    verifyChunk: async () => {
      verifyCalls += 1;
      return synthCalls >= 2
        ? { ok: true, coverage: 1, missingWords: [], suspectWords: [] }
        : { ok: false, coverage: 0.5, missingWords: ['test'], suspectWords: [] };
    },
  });

  assert.equal(synthCalls, 2);
  assert.equal(verifyCalls, 2);
  assert.equal(result.audioBuffer.toString('utf-8'), 'RIFF-take-2');
  // Each re-seed must vary the seed (a genuinely different take).
  assert.notEqual(seeds[0], seeds[1]);
});

test('handleLiveTtsRequest ships the best-effort take when every retry is rejected', async () => {
  const module = await loadInferenceRouteModule();

  let synthCalls = 0;
  const result = await module.handleLiveTtsRequest({
    text: 'A stubborn medical phrase.',
    ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
    aux_ref_audio_paths: [],
  }, {
    resolveParams: async (body) => ({ ...body, ref_audio_path: '/tmp/reference.wav' }),
    synthesize: async () => {
      synthCalls += 1;
      // Second take covers the most words → highest score → should be the one shipped.
      return Buffer.from(`RIFF-take-${synthCalls}`);
    },
    verifyChunk: async () => (synthCalls === 2
      ? { ok: false, coverage: 0.9, missingWords: ['x'], suspectWords: [] }
      : { ok: false, coverage: 0.3, missingWords: ['a', 'b'], suspectWords: [] }),
    retryCount: 2,
  });

  // 3 takes attempted (initial + 2 retries), none accepted, best-effort returned.
  assert.equal(synthCalls, 3);
  assert.equal(result.audioBuffer.toString('utf-8'), 'RIFF-take-2');
});

test('handleLiveTtsRequest removes pause-heavy periods from dotted initialisms', async () => {
  const module = await loadInferenceRouteModule();

  await module.handleLiveTtsRequest({
    text: 'The W.H.O guidance changed.',
    ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
    aux_ref_audio_paths: [],
  }, {
    resolveParams: async (body) => ({
      ...body,
      ref_audio_path: '/tmp/reference.wav',
    }),
    synthesize: async (params) => {
      assert.match(params.text, /double you aitch oh/u);
      assert.doesNotMatch(params.text, /W\.H\.O/u);
      return Buffer.from('RIFFdemo');
    },
  });
});
