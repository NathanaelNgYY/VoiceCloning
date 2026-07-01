import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitTextIntoChunks,
  analyzeAudioQuality,
  applyFullInferenceQualityPreset,
  fullInferenceQualityOptions,
  buildAttemptVariants,
  synthesizeLongText,
  concatWavs,
  insertCommaPauses,
  parseWav,
} from './longTextInference.js';
import { inferenceServer } from './inferenceServer.js';

// A valid PCM16 mono WAV that is genuinely silent (all zero samples) — exactly
// what GPT-SoVITS returns when the AR decoder predicts an early end-of-sequence.
function makeSilentWav(durationSec = 1.0, sampleRate = 32000) {
  const blockAlign = 2;
  const frameCount = Math.round(durationSec * sampleRate);
  const dataSize = frameCount * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28); buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  return buf;
}

// Build a valid PCM16 mono WAV of a given duration filled with mild noise
// (healthy RMS, not silent, not clipped, low autocorrelation so it isn't
// mistaken for a loop). Lets us probe the duration-based skip detector.
function makeNoiseWav(durationSec, sampleRate = 32000) {
  const blockAlign = 2; // mono, 16-bit
  const frameCount = Math.round(durationSec * sampleRate);
  const dataSize = frameCount * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28); buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  let seed = 12345;
  for (let i = 0; i < frameCount; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = ((seed / 0x7fffffff) * 2 - 1) * 0.3 * 32767;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), 44 + i * blockAlign);
  }
  return buf;
}

function makeSparseQuietWav(durationSec, sampleRate = 32000) {
  const blockAlign = 2;
  const frameCount = Math.round(durationSec * sampleRate);
  const dataSize = frameCount * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28); buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < frameCount; i++) {
    const value = i % 100 === 0 ? 140 : 0;
    buf.writeInt16LE(value, 44 + i * blockAlign);
  }
  return buf;
}

// A hyphen used as a dash with spaces around it (" - ") reaches GPT-SoVITS as a
// bare hyphen-minus, which the English G2P verbalizes as the word "minus".
// It must be normalized to a comma pause before chunking (the shared
// prepareTextForSynthesis converts " - " to ", " rather than an em-dash).
test('spaced hyphen dash is converted to a comma pause so TTS does not say "minus"', () => {
  const chunks = splitTextIntoChunks('every cell must obey - how energy flows.');
  const joined = chunks.join(' ');
  assert.ok(!/\s-\s/.test(joined), `no spaced hyphen should survive: "${joined}"`);
  assert.ok(!/[–—]/.test(joined), `no en/em-dash should survive either: "${joined}"`);
});

test('multiple spaced dashes in one line are all converted', () => {
  const chunks = splitTextIntoChunks('the total disorder - or entropy - always increases.');
  const joined = chunks.join(' ');
  assert.ok(!/\s-\s/.test(joined), `no spaced hyphen should survive: "${joined}"`);
});

// Regression guard: intra-word hyphens must still become a plain space
// ("real-time" → "real time"), the existing behavior.
test('intra-word hyphen still becomes a space', () => {
  const chunks = splitTextIntoChunks('this is a real-time system.');
  const joined = chunks.join(' ');
  assert.ok(joined.includes('real time'), `intra-word hyphen should split: "${joined}"`);
});

// The delta symbol must be spoken as the word "delta", never "triangle".
// Handles both attached ("ΔG") and spaced ("Δ G") forms.
test('attached delta symbol becomes "delta G"', () => {
  const chunks = splitTextIntoChunks('The free-energy change ΔG is negative.');
  const joined = chunks.join(' ');
  assert.ok(/delta\s+G/i.test(joined), `delta symbol should become the word "delta": "${joined}"`);
  assert.ok(!joined.includes('Δ'), `no raw delta symbol should survive: "${joined}"`);
});

test('increment symbol also becomes "delta"', () => {
  const chunks = splitTextIntoChunks('Here ∆G equals zero.');
  const joined = chunks.join(' ');
  assert.ok(/delta\s+G/i.test(joined), `increment symbol should become "delta": "${joined}"`);
  assert.ok(!joined.includes('∆'), `no raw increment symbol should survive: "${joined}"`);
});

// A short lead-in clause ("Typically,", "However,", "Therefore,") must not be
// stranded as its own 1-2 word chunk — GPT-SoVITS has no context to pace a lone
// word and rushes it. It should merge forward into the following clause.
test('a short lead-in clause is merged forward, not left as a rushed micro-chunk', () => {
  const chunks = splitTextIntoChunks('Typically, large fuel molecules are broken down into smaller biomolecules.');
  assert.ok(
    !chunks.some(c => c.trim() === 'Typically,'),
    `"Typically," should not be its own chunk: ${JSON.stringify(chunks)}`,
  );
  assert.ok(
    chunks.some(c => /Typically,\s+large fuel/i.test(c)),
    `"Typically" should merge with the next clause: ${JSON.stringify(chunks)}`,
  );
});

// Skip detector: a chunk whose audio is far too short for its text almost
// certainly dropped words and must be flagged so it gets re-rolled.
const SKIP_TEXT = 'large fuel molecules are broken down into smaller biomolecules and energy currency';

test('audio far too short for its text is flagged as likely dropped words', () => {
  const result = analyzeAudioQuality(makeNoiseWav(1.0), SKIP_TEXT); // ~82 chars in 1s = impossibly fast
  assert.equal(result.ok, false, `should be flagged (${result.durationSec?.toFixed(2)}s): ${result.reason}`);
  assert.match(result.reason || '', /too short/i);
});

test('audio of natural length for its text is not flagged short', () => {
  const result = analyzeAudioQuality(makeNoiseWav(6.0), SKIP_TEXT); // ~82 chars in 6s = normal pace
  assert.doesNotMatch(result.reason || '', /too short/i, `should not be flagged short: ${result.reason}`);
});

test('quiet recoverable audio with a real waveform is not rejected as silent', () => {
  const result = analyzeAudioQuality(makeSparseQuietWav(6.0), 'short phrase');
  assert.doesNotMatch(result.reason || '', /silent/i, `quiet non-empty audio should be recoverable: ${result.reason}`);
});

test('full inference quality preset keeps caller sampling controls when provided', () => {
  const params = applyFullInferenceQualityPreset({
    text: 'Photosynthesis converts light into chemical energy.',
    top_k: 1,
    top_p: 1,
    temperature: 1,
    repetition_penalty: 1,
    speed_factor: 1.8,
  });

  assert.equal(params.top_k, 1);
  assert.equal(params.top_p, 1);
  assert.equal(params.temperature, 1);
  assert.equal(params.repetition_penalty, 1);
  assert.equal(params.speed_factor, 1.8);
});

test('full inference quality preset fills system defaults when controls are omitted', () => {
  const params = applyFullInferenceQualityPreset({
    text: 'Photosynthesis converts light into chemical energy.',
  });

  assert.equal(params.top_k, 5);
  assert.equal(params.top_p, 0.85);
  assert.equal(params.temperature, 0.7);
  assert.equal(params.repetition_penalty, 1.35);
  assert.equal(params.speed_factor, 1.0);
});

test('full inference quality chunks keep normal sentences together for flow', () => {
  const text = 'The first sentence should stay intact for natural prosody. The second sentence should also stay intact.';
  const chunks = splitTextIntoChunks(text, { maxChunkLength: 220, maxSentencesPerChunk: 1 });

  assert.deepEqual(chunks, [
    'The first sentence should stay intact for natural prosody.',
    'The second sentence should also stay intact.',
  ]);
});

test('long sentences avoid comma-ended chunk boundaries', () => {
  const text = 'This extended introductory clause contains enough descriptive words to reach the safe split zone, and the following phrase continues with several more words so the sentence exceeds the chunk limit without requiring a comma cut.';
  const chunks = splitTextIntoChunks(text, { maxChunkLength: 120, maxSentencesPerChunk: 50 });

  assert.ok(chunks.length > 1, `expected a split for an over-limit sentence: ${JSON.stringify(chunks)}`);
  assert.ok(
    !chunks.slice(0, -1).some(chunk => /,\s*$/u.test(chunk)),
    `no intermediate chunk should end at a comma: ${JSON.stringify(chunks)}`,
  );
});

test('full inference quality keeps comma splicing off by default (opt-in via env)', () => {
  const options = fullInferenceQualityOptions();
  // Timestamp-spliced comma breaths still glitch in practice, so default is cut0-only.
  assert.equal(options.commaPauseMs, 0);
});

test('retry takes are voice-faithful: ONLY the seed changes', () => {
  const base = applyFullInferenceQualityPreset({
    text: 'Cellular respiration releases energy from glucose.',
    seed: 100,
  });

  const first = buildAttemptVariants(base, 0);
  const second = buildAttemptVariants(base, 1);
  const third = buildAttemptVariants(base, 2);

  // Sampling params mirror Live Fast (top_k 5, temperature 0.7).
  assert.equal(first.temperature, 0.7);
  assert.equal(first.top_p, 0.85);
  assert.equal(first.top_k, 5);
  assert.equal(first.text_split_method, 'cut0');

  // Every later take keeps the SAME voice-shaping parameters as the first — the
  // cloned voice never drifts to recover a word, and repetition_penalty stays pinned
  // (relaxing it was what caused the "barrels of barrels" stutter).
  for (const take of [second, third]) {
    assert.equal(take.temperature, first.temperature, 'temperature must not change');
    assert.equal(take.top_p, first.top_p, 'top_p must not change');
    assert.equal(take.top_k, first.top_k, 'top_k must not change');
    assert.equal(take.text_split_method, first.text_split_method, 'split method must not change');
    assert.equal(take.speed_factor, first.speed_factor, 'speed must not change');
    assert.equal(take.repetition_penalty, first.repetition_penalty, 'repetition_penalty must not change');
  }

  // Only the seed varies (to explore a different read).
  assert.equal(second.seed, 117);
  assert.notEqual(third.seed, second.seed);
});

// In full-inference mode (maxSentencesPerChunk: 1) the chunker used to strand a
// short complete sentence ("Yes.") as its own tiny chunk. GPT-SoVITS renders
// such a fragment as a near-silent buffer, and a long passage contains enough of
// them that one eventually defeats every retry and aborts the whole job.
test('full inference never emits a tiny standalone chunk (silent-buffer trigger)', () => {
  const text = "Yes. The mitochondria produce most of the cell's usable chemical energy through respiration.";
  const chunks = splitTextIntoChunks(text, { maxChunkLength: 220, maxSentencesPerChunk: 1 });
  for (const chunk of chunks) {
    assert.ok(chunk.trim().length >= 24, `chunk too short, will render silent: ${JSON.stringify(chunks)}`);
  }
});

test('a short trailing clause is folded back instead of stranded as a tiny chunk', () => {
  const text = 'The reaction releases a very large amount of usable energy almost instantly, so fast.';
  const chunks = splitTextIntoChunks(text, { maxChunkLength: 220, maxSentencesPerChunk: 1 });
  for (const chunk of chunks) {
    assert.ok(chunk.trim().length >= 24, `chunk too short, will render silent: ${JSON.stringify(chunks)}`);
  }
});

// A short lead-in to the NEXT sentence ("Structurally,") used to be folded
// backward onto the previous COMPLETE sentence, producing a chunk that straddled a
// full stop with a dangling trailing word — the exact chunk the model mangled and
// dropped words from. It must fold forward into the clause it introduces instead.
test('a lead-in fragment folds forward, never straddling the previous full stop', () => {
  const text = 'Each centriole is made up of barrels of nine triplet microtubules. Structurally, three microtubule filaments arrange themselves repeatedly.';
  const chunks = splitTextIntoChunks(text, { maxChunkLength: 220, maxSentencesPerChunk: 1 });
  for (const chunk of chunks) {
    assert.ok(chunk.trim().length >= 24, `chunk too short: ${JSON.stringify(chunks)}`);
    // No chunk should contain a sentence-final period followed by more words.
    assert.ok(
      !/[.!?]\s+\S/.test(chunk),
      `chunk straddles a sentence boundary: ${JSON.stringify(chunk)}`,
    );
  }
  assert.ok(
    chunks.some(c => /Structurally,\s+three microtubule/i.test(c)),
    `"Structurally," should lead the next clause: ${JSON.stringify(chunks)}`,
  );
});

// The whole point of the long-text path is that one stubborn chunk must never
// sink a long generation. When every retry yields silence, keep the best-effort
// audio and finish the job rather than throwing.
test('long-text synthesis keeps best-effort audio instead of aborting on a silent chunk', async () => {
  mock.method(inferenceServer, 'synthesize', async () => makeSilentWav(1.0));
  try {
    const result = await synthesizeLongText(
      applyFullInferenceQualityPreset({ text: 'A short standalone sentence for synthesis.' }),
      fullInferenceQualityOptions({ retryCount: 1 }),
    );
    assert.ok(Buffer.isBuffer(result.audioBuffer) && result.audioBuffer.length > 44);
  } finally {
    mock.restoreAll();
  }
});

// Regression: when no clean read exists, the best-effort fallback must speak the
// WHOLE chunk. It used to substitute a single passing sub-span (e.g. a good first
// half) for the entire chunk, dropping the rest — that was "it skipped barrels all
// the way". The fallback must synthesize every span so no words are lost.
test('best-effort fallback covers the whole chunk, never a partial span', async () => {
  const text = 'Each centriole is made up of barrels of nine triplet microtubules.';
  const seen = [];
  mock.method(inferenceServer, 'synthesize', async (params) => {
    seen.push(params.text);
    return makeNoiseWav(Math.max(2, params.text.length * 0.1)); // natural length so audio isn't flagged "too short"
  });
  try {
    const result = await synthesizeLongText(
      applyFullInferenceQualityPreset({ text }),
      fullInferenceQualityOptions({
        retryCount: 0,
        // Always-reject verifier forces every clean retry to fail and the full-span
        // best-effort fallback to run.
        verifyChunk: async () => ({ ok: false, coverage: 0.5, missingWords: ['centriole'], suspectWords: [] }),
      }),
    );
    assert.ok(Buffer.isBuffer(result.audioBuffer) && result.audioBuffer.length > 44);
    // The spans synthesized in the fallback must together reconstruct the full text.
    const joined = seen.join(' ').toLowerCase();
    for (const word of ['barrels', 'nine', 'triplet', 'microtubules']) {
      assert.ok(joined.includes(word), `fallback dropped "${word}": synthesized ${JSON.stringify(seen)}`);
    }
  } finally {
    mock.restoreAll();
  }
});

test('insertCommaPauses splices exactly one silence per comma using word timings', () => {
  const sampleRate = 32000;
  const audio = makeNoiseWav(2.0, sampleRate); // 2.0s mono PCM16
  const words = [
    { w: 'hello', start: 0.0, end: 0.5 },
    { w: 'world', start: 0.5, end: 1.0 },
    { w: 'goodbye', start: 1.1, end: 1.6 },
    { w: 'now', start: 1.6, end: 2.0 },
  ];
  const pauseMs = 120;
  const out = insertCommaPauses(audio, 'hello world, goodbye now', words, pauseMs);
  const before = parseWav(audio).dataChunk.length;
  const after = parseWav(out).dataChunk.length;
  const expectedSilence = Math.round((pauseMs / 1000) * sampleRate) * 2; // mono, 2 bytes/frame
  assert.equal(after - before, expectedSilence, 'exactly one comma breath inserted');
});

test('insertCommaPauses is a no-op when disabled, no comma, or word count drifts', () => {
  const audio = makeNoiseWav(1.0, 32000);
  const words = [{ w: 'a', start: 0, end: 0.5 }, { w: 'b', start: 0.5, end: 1.0 }];
  // disabled
  assert.equal(insertCommaPauses(audio, 'a, b', words, 0).length, audio.length);
  // no comma
  assert.equal(insertCommaPauses(audio, 'a b', words, 120).length, audio.length);
  // word-count drift > 2 (placement would be unreliable) → unchanged
  assert.equal(insertCommaPauses(audio, 'a, b c d e f', words, 120).length, audio.length);
});

test('single-chunk full inference preserves the model\'s natural loudness', async () => {
  // makeNoiseWav generates audio at ~0.3 peak. A single chunk has no siblings to
  // even out against, so it must NOT be boosted toward an absolute target — that
  // inflation is what made Live Full sound louder and less like the reference.
  mock.method(inferenceServer, 'synthesize', async () => makeNoiseWav(4.0));
  try {
    const result = await synthesizeLongText(
      applyFullInferenceQualityPreset({ text: 'A normal sentence should keep its natural playback volume.' }),
      fullInferenceQualityOptions({ retryCount: 0 }),
    );
    const analysis = analyzeAudioQuality(result.audioBuffer, 'A normal sentence should keep its natural playback volume.');
    assert.ok(
      analysis.metrics.absPeak < 0.4,
      `single chunk should keep its natural peak, not be boosted: ${JSON.stringify(analysis.metrics)}`,
    );
  } finally {
    mock.restoreAll();
  }
});

test('joined chunks are matched to a shared loudness without inflation', () => {
  // Two chunks at different peaks (0.3 and 0.6) should converge toward their
  // median (~0.45) so playback is even — but the result must not be pushed above
  // the louder source chunk.
  const quiet = makeNoiseWav(1.0);          // ~0.3 peak
  const loud = makeNoiseWav(1.0);
  for (let i = 44; i + 1 < loud.length; i += 2) {
    const doubled = Math.max(-32768, Math.min(32767, loud.readInt16LE(i) * 2));
    loud.writeInt16LE(doubled, i);          // ~0.6 peak
  }
  const joined = concatWavs([Buffer.from(quiet), Buffer.from(loud)], 0);
  const analysis = analyzeAudioQuality(joined, 'shared loudness check');
  assert.ok(
    analysis.metrics.absPeak > 0.3 && analysis.metrics.absPeak <= 0.62,
    `joined chunks should sit near the median, not be inflated: ${JSON.stringify(analysis.metrics)}`,
  );
});

test('concatWavs preserves generated chunk samples at joins', () => {
  const first = makeNoiseWav(0.25);
  const second = makeNoiseWav(0.25);
  const joined = concatWavs([Buffer.from(first), Buffer.from(second)], 0);

  const expected = Buffer.concat([
    parseWav(first).dataChunk,
    parseWav(second).dataChunk,
  ]);

  assert.deepEqual(parseWav(joined).dataChunk, expected);
});

test('concatWavs trims trailing model silence before an inserted pause', () => {
  // A chunk of speech (noise) followed by the model's 0.3s trailing near-silence.
  const withTail = concatWavs(
    [Buffer.from(makeNoiseWav(0.25)), Buffer.from(makeSilentWav(0.3))],
    0, // pure concat, no trim/fade — just build the tailed chunk
  );
  const second = makeNoiseWav(0.25);

  const sampleRate = 32000;
  const gapMs = 120;
  const joined = concatWavs([Buffer.from(withTail), Buffer.from(second)], gapMs);
  const joinedFrames = parseWav(joined).dataChunk.length / 2;

  // If the 0.3s tail were kept it would stack on the 0.12s pause. Trimming drops the
  // tail (keeping a ~30ms margin), so the join is far shorter than the untrimmed sum.
  const untrimmedFrames = Math.round((0.25 + 0.3 + gapMs / 1000 + 0.25) * sampleRate);
  assert.ok(
    joinedFrames < untrimmedFrames - 0.2 * sampleRate,
    `expected trim: joinedFrames=${joinedFrames} untrimmed=${untrimmedFrames}`,
  );
});

// A genuine inference-server failure (no audio ever produced) must still surface
// as an error — best-effort fallback only applies when we actually got audio.
test('long-text synthesis still surfaces a genuine inference-server failure', async () => {
  mock.method(inferenceServer, 'synthesize', async () => { throw new Error('inference server exploded'); });
  try {
    await assert.rejects(
      synthesizeLongText(
        applyFullInferenceQualityPreset({ text: 'A short standalone sentence for synthesis.' }),
        fullInferenceQualityOptions({ retryCount: 0 }),
      ),
    );
  } finally {
    mock.restoreAll();
  }
});

test('seed -1 is treated as random instead of a deterministic retry seed base', () => {
  const params = buildAttemptVariants(applyFullInferenceQualityPreset({
    text: 'Seed minus one should let the worker choose a usable random seed.',
    seed: -1,
  }), 0);

  assert.notEqual(params.seed, -1);
  assert.equal(Number.isInteger(params.seed), true);
  assert.ok(params.seed >= 0);
});

test('even a late retry take stays voice-faithful (natural params, just a new seed)', () => {
  const base = applyFullInferenceQualityPreset({
    text: 'The final attempt should still sound like the cloned voice.',
    seed: 200,
  });
  const first = buildAttemptVariants(base, 0);
  const params = buildAttemptVariants(base, 4);

  assert.equal(params.seed, 267); // 200 + seed offset for index 4
  // Voice-shaping parameters are unchanged from the first take.
  assert.equal(params.temperature, first.temperature);
  assert.equal(params.top_p, first.top_p);
  assert.equal(params.top_k, first.top_k);
  assert.equal(params.text_split_method, first.text_split_method);
  // repetition_penalty stays pinned at the base across every take (no relaxation).
  assert.equal(params.repetition_penalty, first.repetition_penalty);
});
