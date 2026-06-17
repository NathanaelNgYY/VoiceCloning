import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTextIntoChunks } from './longTextInference.js';

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
