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

function makeToneWav(durationMs, sampleRate = 32000) {
  const frameCount = Math.round((durationMs / 1000) * sampleRate);
  const dataSize = frameCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let frame = 0; frame < frameCount; frame += 1) {
    buffer.writeInt16LE(
      Math.round(4000 * Math.sin((2 * Math.PI * 220 * frame) / sampleRate)),
      44 + frame * 2,
    );
  }
  return buffer;
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

test('Live Fast expands a break into separate verified clips and exact joined silence', async () => {
  const module = await loadInferenceRouteModule();
  const synthesizedTexts = [];
  const verifiedTexts = [];

  const result = await module.handleLiveTtsRequest({
    text: 'hello <break time="7000ms"/> hello',
    ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
    aux_ref_audio_paths: [],
  }, {
    resolveParams: async (body) => ({ ...body, ref_audio_path: '/tmp/reference.wav' }),
    synthesize: async (params) => {
      synthesizedTexts.push(params.text);
      return makeToneWav(300);
    },
    verifyChunk: async (_audio, text) => {
      verifiedTexts.push(text);
      return { ok: true, coverage: 1, missingWords: [], suspectWords: [] };
    },
  });

  assert.deepEqual(synthesizedTexts.map(text => text.trim()), ['hello', 'hello']);
  assert.deepEqual(verifiedTexts, ['hello', 'hello']);
  const durationMs = Math.round((result.audioBuffer.readUInt32LE(40) / 2 / 32000) * 1000);
  assert.ok(durationMs >= 7550 && durationMs <= 7650, `unexpected joined duration: ${durationMs}ms`);
});

test('Live Fast preserves leading and trailing break silence without changing synthesis text', async () => {
  const module = await loadInferenceRouteModule();
  const result = await module.handleLiveTtsRequest({
    text: '<break time="500ms"/> hello <break time="700ms"/>',
    ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
  }, {
    resolveParams: async (body) => ({ ...body, ref_audio_path: '/tmp/reference.wav' }),
    synthesize: async (params) => {
      assert.equal(params.text.trim(), 'hello');
      return makeToneWav(300);
    },
    verifyChunk: async () => ({ ok: true, coverage: 1, missingWords: [], suspectWords: [] }),
  });
  const durationMs = Math.round((result.audioBuffer.readUInt32LE(40) / 2 / 32000) * 1000);
  assert.ok(durationMs >= 1490 && durationMs <= 1510, `unexpected boundary-padded duration: ${durationMs}ms`);
});

test('Live Fast applies requested output gain only after verification', async () => {
  const module = await loadInferenceRouteModule();
  const source = makeToneWav(300);
  let verifiedPeak = 0;
  const result = await module.handleLiveTtsRequest({
    text: 'clear output',
    ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
    output_gain_db: 6,
  }, {
    resolveParams: async (body) => ({ ...body, ref_audio_path: '/tmp/reference.wav' }),
    synthesize: async () => source,
    verifyChunk: async (audio) => {
      for (let offset = 44; offset + 1 < audio.length; offset += 2) {
        verifiedPeak = Math.max(verifiedPeak, Math.abs(audio.readInt16LE(offset)));
      }
      return { ok: true, coverage: 1, missingWords: [], suspectWords: [] };
    },
  });
  let deliveredPeak = 0;
  for (let offset = 44; offset + 1 < result.audioBuffer.length; offset += 2) {
    deliveredPeak = Math.max(deliveredPeak, Math.abs(result.audioBuffer.readInt16LE(offset)));
  }
  assert.ok(deliveredPeak > verifiedPeak * 1.8, `${deliveredPeak} should exceed verified ${verifiedPeak}`);
  assert.ok(deliveredPeak <= Math.round(32767 * 0.891));
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

test('handleLiveTtsRequest leaves compact chemical formulas unchanged on Live Fast', async () => {
  const module = await loadInferenceRouteModule();

  await module.handleLiveTtsRequest({
    text: 'Compare C6H12O6 with (CH2O)n.',
    ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
    aux_ref_audio_paths: [],
  }, {
    resolveParams: async (body) => ({
      ...body,
      ref_audio_path: '/tmp/reference.wav',
    }),
    synthesize: async (params) => {
      assert.match(params.text, /C6H12O6/u);
      assert.match(params.text, /\(CH2O\)n/u);
      assert.doesNotMatch(params.text, /open parenthesis|twelve/u);
      return Buffer.from('RIFFdemo');
    },
    verifyChunk: null,
  });
});
