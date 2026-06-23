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
