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
import {
  splitTextIntoChunks,
  computeChunkPauses,
  concatWavs,
  parseWav,
  synthesizeBreakAwareFullChunk,
} from './longTextInference.js';

// Build a PCM16 mono WAV: leadMs of silence, toneMs of 220Hz tone, trailMs of silence.
function makeWav({ toneMs, leadMs = 0, trailMs = 0, sr = 32000 }) {
  const ms2n = (ms) => Math.round((sr * ms) / 1000);
  const lead = ms2n(leadMs); const tone = ms2n(toneMs); const trail = ms2n(trailMs);
  const n = lead + tone + trail;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < tone; i += 1) {
    data.writeInt16LE(Math.round(4000 * Math.sin((2 * Math.PI * 220 * i) / sr)), (lead + i) * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function durationMs(wav, sr = 32000) {
  return Math.round((parseWav(wav).dataChunk.length / 2 / sr) * 1000);
}

test('a break gap ~= requested duration, not stacked on the model silence', () => {
  // Two 300ms tones each padded with 800ms of model silence at the joined edges.
  const a = makeWav({ toneMs: 300, trailMs: 800 });
  const b = makeWav({ toneMs: 300, leadMs: 800 });
  const total = durationMs(concatWavs([a, b], [700]));
  // Ideal = 300 + 700 + 300 = 1300; allow ~2x30ms keep margins + rounding.
  assert.ok(total >= 1250 && total <= 1450, `gap not tight: ${total}ms`);
});

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

test('long breaks are honored up to the cap; a wild typo is clamped', () => {
  assert.equal(splitOnBreaks(expandSsml('a <break time="7000ms"/> b'))[0].breakMsAfter, 7000);
  assert.equal(splitOnBreaks(expandSsml('a <break time="7s"/> b'))[0].breakMsAfter, 7000);
  assert.equal(splitOnBreaks(expandSsml('a <break time="500s"/> b'))[0].breakMsAfter, 10000);
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

test('targeted Full regeneration uses the same break-aware chunk and join pipeline', async () => {
  const expanded = expandSsml('hello <break time="7000ms"/> hello');
  const synthesizedTexts = [];
  const result = await synthesizeBreakAwareFullChunk(
    expanded,
    { text: expanded },
    { chunkJoinPauseMs: 0 },
    {
      synthesizeChunk: async (text) => {
        synthesizedTexts.push(stripBreakSentinels(text));
        return { audioBuffer: makeWav({ toneMs: 300 }), attempts: 1 };
      },
    },
  );

  assert.deepEqual(synthesizedTexts, ['hello', 'hello']);
  assert.equal(result.attempts, 2);
  const total = durationMs(result.audioBuffer);
  assert.ok(total >= 7550 && total <= 7650, `unexpected regenerated duration: ${total}ms`);
});

test('text with no breaks chunks exactly as before', () => {
  const plain = 'First sentence here today. Second sentence follows now.';
  const withApi = splitTextIntoChunks(plain, { maxChunkLength: 80 });
  assert.ok(withApi.every((c) => extractBreakMs(c) === null));
});
