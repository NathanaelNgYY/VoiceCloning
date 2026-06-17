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
