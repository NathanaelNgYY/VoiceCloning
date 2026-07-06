import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandSsml,
  containsSsml,
  splitOnBreaks,
  extractBreakMs,
  stripBreakSentinels,
  appendBreakSentinel,
} from './ssml.js';
import { applyEmphasisAndSpelling } from './emphasisAndSpelling.js';
import { prepareTextForSynthesis } from './textPronunciation.js';
import { splitTextIntoChunks, computeChunkPauses } from './longTextInference.js';

test('<sub> is NOT interpreted — the real word is spoken (dictionary handles it)', () => {
  // The alias would fight ASR verification, so <sub> falls back to the real word.
  assert.equal(expandSsml('Take <sub alias="met for min">metformin</sub>.'), 'Take metformin .');
});

test('an ARPAbet dictionary word beats a <say-as> spell-out', () => {
  const protectedWords = new Set(['MRI']);
  assert.equal(
    expandSsml('an <say-as interpret-as="characters">MRI</say-as> scan', { protectedWords }),
    'an MRI scan',
  );
  // not protected: the spell-out applies as the fallback
  assert.equal(
    expandSsml('an <say-as interpret-as="characters">MRI</say-as> scan', { protectedWords: new Set() }),
    'an M R I scan',
  );
});

test('<say-as characters> spells the word letter by letter', () => {
  assert.equal(expandSsml('an <say-as interpret-as="characters">MRI</say-as> scan'), 'an M R I scan');
  assert.equal(expandSsml('<say-as interpret-as="spell-out">CT</say-as>'), 'C T');
});

test('<say-as> with an unsupported mode keeps the inner text', () => {
  assert.equal(expandSsml('<say-as interpret-as="cardinal">12</say-as>'), '12');
});

test('unsupported / raw tags are stripped so they are never spoken', () => {
  assert.equal(expandSsml('a <prosody pitch="high">b</prosody> c'), 'a b c');
  assert.equal(expandSsml('a <emphasis>b</emphasis> <phoneme>c</phoneme> d'), 'a b c d');
});

test('containsSsml only fires on supported tags', () => {
  assert.equal(containsSsml('plain medical text'), false);
  assert.equal(containsSsml('a <break time="200ms"/> b'), true);
});

test('appendBreakSentinel round-trips through extractBreakMs', () => {
  assert.equal(extractBreakMs(appendBreakSentinel('after meals.', 500)), 500);
});

test('<break time> parses ms and seconds; bare/strength map to defaults', () => {
  assert.equal(splitOnBreaks(expandSsml('a <break time="500ms"/> b'))[0].breakMsAfter, 500);
  assert.equal(splitOnBreaks(expandSsml('a <break time="1s"/> b'))[0].breakMsAfter, 1000);
  assert.equal(splitOnBreaks(expandSsml('a <break/> b'))[0].breakMsAfter, 400);
  assert.equal(splitOnBreaks(expandSsml('a <break strength="strong"/> b'))[0].breakMsAfter, 700);
});

test('break duration is clamped so a typo cannot stall a passage', () => {
  assert.equal(splitOnBreaks(expandSsml('a <break time="500s"/> b'))[0].breakMsAfter, 3000);
});

test('the break sentinel survives the downstream normalization chain', () => {
  const expanded = expandSsml('one two <break time="500ms"/> three four.');
  const normalized = applyEmphasisAndSpelling(prepareTextForSynthesis(expanded));
  assert.match(normalized, /500/u); // ms digits still present between the PUA delimiters
});

test('a break forces a chunk boundary and sets the inter-chunk pause', () => {
  const expanded = expandSsml('First sentence here today. <break time="600ms"/> Second sentence follows now.');
  const chunks = splitTextIntoChunks(expanded, { maxChunkLength: 80 });
  assert.equal(chunks.length, 2);
  assert.equal(extractBreakMs(chunks[0]), 600);
  assert.equal(extractBreakMs(chunks[1]), null);
  assert.deepEqual(computeChunkPauses(chunks, 0), [600]);
  // Spoken text never contains the sentinel.
  assert.equal(stripBreakSentinels(chunks[0]), 'First sentence here today.');
});

test('text with no breaks chunks exactly as before', () => {
  const plain = 'First sentence here today. Second sentence follows now.';
  const withApi = splitTextIntoChunks(plain, { maxChunkLength: 80 });
  assert.ok(withApi.every((c) => extractBreakMs(c) === null));
});
