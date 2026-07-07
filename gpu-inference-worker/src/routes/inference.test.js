import test from 'node:test';
import assert from 'node:assert/strict';

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
      assert.match(params.text, /W H O/u);
      assert.doesNotMatch(params.text, /W\.H\.O/u);
      return Buffer.from('RIFFdemo');
    },
  });
});

// ── live-clip stutter verification ───────────────────────────────────────────
// GPT-SoVITS occasionally re-emits a word ("treatment and treatment") or
// false-starts a long one ("gastro gastrointestinal"). The live path verifies
// each clip with the ASR sidecar and re-rolls ONCE on a bad take. The client
// marks the first clip of a reply skip_verify so time-to-first-audio is never
// delayed by verification.

test('handleLiveTtsRequest re-rolls once when the clip verifier hears a stutter', async () => {
  const module = await loadInferenceRouteModule();

  let synthesizeCalls = 0;
  let verifyCalls = 0;
  const result = await module.handleLiveTtsRequest({
    text: 'The gastrointestinal tract heals.',
    ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
    aux_ref_audio_paths: [],
  }, {
    resolveParams: async (body) => ({ ...body, ref_audio_path: '/tmp/reference.wav' }),
    synthesize: async () => {
      synthesizeCalls += 1;
      return Buffer.from(synthesizeCalls === 1 ? 'RIFFbad' : 'RIFFgood');
    },
    verifyClip: async (audioBuffer, expectedText) => {
      verifyCalls += 1;
      assert.ok(expectedText.includes('gastrointestinal'));
      return { ok: false, duplicatedWords: ['gastro'] };
    },
  });

  assert.equal(synthesizeCalls, 2, 'one re-roll after the bad take');
  assert.equal(verifyCalls, 1, 'the retry is NOT re-verified (it plays regardless)');
  assert.equal(result.audioBuffer.toString('utf-8'), 'RIFFgood');
});

test('handleLiveTtsRequest plays the first take when verification passes', async () => {
  const module = await loadInferenceRouteModule();

  let synthesizeCalls = 0;
  const result = await module.handleLiveTtsRequest({
    text: 'Timing of treatment matters.',
    ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
    aux_ref_audio_paths: [],
  }, {
    resolveParams: async (body) => ({ ...body, ref_audio_path: '/tmp/reference.wav' }),
    synthesize: async () => {
      synthesizeCalls += 1;
      return Buffer.from('RIFFdemo');
    },
    verifyClip: async () => ({ ok: true, duplicatedWords: [] }),
  });

  assert.equal(synthesizeCalls, 1);
  assert.equal(result.audioBuffer.toString('utf-8'), 'RIFFdemo');
});

test('handleLiveTtsRequest honors skip_verify and never forwards it to the engine', async () => {
  const module = await loadInferenceRouteModule();

  let verifyCalls = 0;
  let synthesizeCalls = 0;
  await module.handleLiveTtsRequest({
    text: 'Hello there.',
    skip_verify: true,
    ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
    aux_ref_audio_paths: [],
  }, {
    resolveParams: async (body) => ({ ...body, ref_audio_path: '/tmp/reference.wav' }),
    synthesize: async (params) => {
      synthesizeCalls += 1;
      assert.equal('skip_verify' in params, false, 'engine params must not carry skip_verify');
      return Buffer.from('RIFFdemo');
    },
    verifyClip: async () => {
      verifyCalls += 1;
      return { ok: false };
    },
  });

  assert.equal(synthesizeCalls, 1);
  assert.equal(verifyCalls, 0, 'first clip plays unverified');
});

test('handleLiveTtsRequest treats an unavailable verifier as no opinion', async () => {
  const module = await loadInferenceRouteModule();

  let synthesizeCalls = 0;
  const result = await module.handleLiveTtsRequest({
    text: 'Hello there.',
    ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
    aux_ref_audio_paths: [],
  }, {
    resolveParams: async (body) => ({ ...body, ref_audio_path: '/tmp/reference.wav' }),
    synthesize: async () => {
      synthesizeCalls += 1;
      return Buffer.from('RIFFdemo');
    },
    verifyClip: async () => null,
  });

  assert.equal(synthesizeCalls, 1, 'no opinion never triggers a re-roll');
  assert.equal(result.audioBuffer.toString('utf-8'), 'RIFFdemo');
});
