import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTextIntoChunks, analyzeAudioQuality } from './longTextInference.js';

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

// A hyphen used as a dash with spaces around it (" - ") reaches GPT-SoVITS as a
// bare hyphen-minus, which the English G2P verbalizes as the word "minus".
// It must be normalized to an em-dash (a pause) before chunking.
test('spaced hyphen dash is converted to em-dash so TTS does not say "minus"', () => {
  const chunks = splitTextIntoChunks('every cell must obey - how energy flows.');
  const joined = chunks.join(' ');
  assert.ok(!/\s-\s/.test(joined), `no spaced hyphen should survive: "${joined}"`);
  assert.ok(joined.includes('—'), `an em-dash should be present: "${joined}"`);
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
