import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptionVerifier } from './transcriptionVerifier.js';

// Whisper-style word entry.
function w(word, durationSec, p = 0.95) {
  return { w: word, start: 0, end: durationSec, p };
}

test('dictionary word mis-transcribed but present (word count matches) is forgiven', async () => {
  // Model said every word, just pronounced "centriole" as "sensual". Whisper heard
  // the same NUMBER of words → nothing dropped → forgive the dictionary mis-spelling.
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'The two sensuals are known as the mother sensual and the daughter sensual respectively',
    words: [],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'The two centrioles are known as the mother centriole and the daughter centriole respectively',
      { dictionaryWords: ['centriole', 'centrioles'] },
    );
    assert.equal(res.ok, true, JSON.stringify(res));
  } finally {
    mock.restoreAll();
  }
});

test('dictionary word actually skipped (word count short) is NOT forgiven — still re-rolls', async () => {
  // The model dropped words; the heard count is far short, so the medical word is
  // treated as a real skip and the chunk is rejected (safe for medical text).
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'two sensuals',
    words: [],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'It consists of two centrioles',
      { dictionaryWords: ['centrioles'] },
    );
    assert.equal(res.ok, false, JSON.stringify(res));
  } finally {
    mock.restoreAll();
  }
});

test('an advisory clipped word (low confidence, real audio) no longer forces a re-roll', async () => {
  // 100% coverage; "daughter" is low-confidence but has real audio under it (not a
  // skip). This used to reject a perfect take; now it is advisory only.
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'the daughter centriole respectively',
    words: [w('the', 0.2), w('daughter', 0.5, 0.1), w('centriole', 0.5), w('respectively', 0.6)],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'the daughter centriole respectively',
      {},
    );
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(res.suspectWords.includes('daughter'), 'still reported as advisory');
  } finally {
    mock.restoreAll();
  }
});

test('a short-span word with real audio is advisory only and does NOT re-roll', async () => {
  // "microtubules" given 0.2s is brisk but has real audio. Whisper word-boundary
  // timing is imprecise, so this must NOT force a re-roll (it used to, which made
  // generation slow by re-rolling fully-correct takes). It stays advisory.
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'barrels of nine triplet microtubules',
    words: [w('barrels', 0.5), w('of', 0.2), w('nine', 0.3), w('triplet', 0.5), w('microtubules', 0.2)],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'barrels of nine triplet microtubules',
      {},
    );
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(res.suspectWords.includes('microtubules'), 'still flagged advisory for scoring');
  } finally {
    mock.restoreAll();
  }
});

test('a half-cut word (short audio AND low confidence) forces a re-roll', async () => {
  // 100% coverage, but "microtubules" got too little audio AND low confidence =
  // said partway then cut. Must re-roll even though all words are transcribed.
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'barrels of nine triplet microtubules',
    words: [w('barrels', 0.5), w('of', 0.2), w('nine', 0.3), w('triplet', 0.5), w('microtubules', 0.2, 0.1)],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'barrels of nine triplet microtubules',
      {},
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.ok(res.skippedWords.includes('microtubules'), JSON.stringify(res));
  } finally {
    mock.restoreAll();
  }
});

test('a genuinely skipped word (near-zero audio span) still forces a re-roll', async () => {
  // Whisper hallucinated "centriole" back from context but gave it a 10ms span — no
  // audio under it = real skip. This must still reject even at high coverage.
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'each centriole is made up',
    words: [w('each', 0.3), w('centriole', 0.01), w('is', 0.2), w('made', 0.3), w('up', 0.2)],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'each centriole is made up',
      { dictionaryWords: ['centriole'] },
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.ok(res.skippedWords.includes('centriole'), JSON.stringify(res));
  } finally {
    mock.restoreAll();
  }
});
