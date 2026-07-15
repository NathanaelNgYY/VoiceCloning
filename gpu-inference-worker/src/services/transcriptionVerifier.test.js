import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptionVerifier } from './transcriptionVerifier.js';

// Whisper-style word entry.
function w(word, durationSec, p = 0.95) {
  return { w: word, start: 0, end: durationSec, p };
}

function makePcm16Wav(durationSec, silentRanges = []) {
  const sampleRate = 16000;
  const samples = Math.ceil(durationSec * sampleRate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const time = i / sampleRate;
    const silent = silentRanges.some((range) => time >= range.start && time <= range.end);
    const sample = silent ? 0 : (i % 2 === 0 ? 5000 : -5000);
    data.writeInt16LE(sample, i * 2);
  }
  const wav = Buffer.alloc(44 + data.length);
  wav.write('RIFF', 0, 4, 'ascii');
  wav.writeUInt32LE(36 + data.length, 4);
  wav.write('WAVE', 8, 4, 'ascii');
  wav.write('fmt ', 12, 4, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 4, 'ascii');
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
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

test('Live Full forgives a hard dictionary word only when an aligned timed token was spoken', async () => {
  const heard = 'Km or the mccallus constant describes enzyme kinetics'.split(' ');
  const logs = [];
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: heard.join(' '),
    words: heard.map((word, index) => ({
      w: word,
      start: index,
      end: index + Math.max(0.24, word.length * 0.06),
      p: 0.9,
    })),
  }));
  mock.method(transcriptionVerifier, 'verifyPhonemeBuffer', async () => ({
    ok: true,
    inconclusive: false,
    decision: 'pass',
    expected: 'maɪkeɪlɪs',
    observed: 'maɪkeɪlɪs',
    ctcScore: -0.8,
    similarity: 1,
  }));
  mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      makePcm16Wav(9),
      'Km or the Michaelis constant describes enzyme kinetics',
      {
        dictionaryWords: ['michaelis'],
        dictionaryEntries: [{ word: 'michaelis', arpabet: 'M AY K EY L IH S' }],
        finalWordTailCheck: true,
      },
    );
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(res.forgivenDictionaryWords, ['michaelis']);
    assert.match(logs.find((line) => line.includes('[phoneme]')) || '', /word="michaelis" decision=pass/u);
  } finally {
    mock.restoreAll();
  }
});

test('Live Fast phoneme verification can forgive a Whisper-mismatched dictionary word', async () => {
  const heard = 'Km or the mccallus constant describes enzyme kinetics'.split(' ');
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: heard.join(' '),
    words: heard.map((word, index) => ({
      w: word,
      start: index,
      end: index + Math.max(0.24, word.length * 0.06),
      p: 0.9,
    })),
  }));
  mock.method(transcriptionVerifier, 'verifyPhonemeBuffer', async () => ({
    ok: true,
    inconclusive: false,
    decision: 'pass',
    ctcScore: -0.8,
    similarity: 1,
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      makePcm16Wav(9),
      'Km or the Michaelis constant describes enzyme kinetics',
      {
        dictionaryWords: ['michaelis'],
        dictionaryEntries: [{ word: 'michaelis', arpabet: 'M AY K EY L IH S' }],
        phonemeVerification: true,
      },
    );
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(res.forgivenDictionaryWords, ['michaelis']);
    assert.equal(res.phonemeAssessments[0].decision, 'pass');
  } finally {
    mock.restoreAll();
  }
});

test('Live Fast phoneme rejection rejects a take even when Whisper spells a strict word correctly', async () => {
  const heard = 'Km or the Michaelis constant describes enzyme kinetics'.split(' ');
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: heard.join(' '),
    words: heard.map((word, index) => ({
      w: word,
      start: index,
      end: index + Math.max(0.24, word.length * 0.06),
      p: 0.9,
    })),
  }));
  mock.method(transcriptionVerifier, 'verifyPhonemeBuffer', async () => ({
    ok: false,
    inconclusive: false,
    decision: 'reject',
    ctcScore: -6.2,
    similarity: 0.25,
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      makePcm16Wav(9),
      'Km or the Michaelis constant describes enzyme kinetics',
      {
        dictionaryWords: ['michaelis'],
        dictionaryEntries: [{ word: 'michaelis', arpabet: 'M AY K EY L IH S', verifyPhonemes: true }],
        phonemeVerification: true,
      },
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.equal(res.phonemeAssessments[0].decision, 'reject');
  } finally {
    mock.restoreAll();
  }
});

test('Live Full rejects a present technical word when its phonemes do not match', async () => {
  // Whisper can context-correct a mispronunciation back to the expected spelling;
  // the independent phone check must still reject it.
  const heard = 'Km or the Michaelis constant describes enzyme kinetics'.split(' ');
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: heard.join(' '),
    words: heard.map((word, index) => ({
      w: word,
      start: index,
      end: index + Math.max(0.24, word.length * 0.06),
      p: 0.9,
    })),
  }));
  mock.method(transcriptionVerifier, 'verifyPhonemeBuffer', async () => ({
    ok: false,
    inconclusive: false,
    decision: 'reject',
    expected: 'maɪkeɪlɪs',
    observed: 'mɛkænɪks',
    ctcScore: -6.2,
    similarity: 0.25,
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      makePcm16Wav(9),
      'Km or the Michaelis constant describes enzyme kinetics',
      {
        dictionaryWords: ['michaelis'],
        dictionaryEntries: [{ word: 'michaelis', arpabet: 'M AY K EY L IH S', verifyPhonemes: true }],
        finalWordTailCheck: true,
      },
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.deepEqual(res.forgivenDictionaryWords, []);
    assert.equal(res.phonemeAssessments[0].ok, false);
  } finally {
    mock.restoreAll();
  }
});

test('Live Full does not phoneme-gate an ordinary dictionary word that Whisper transcribed correctly', async () => {
  const heard = 'We introduce two important parameters'.split(' ');
  let phonemeCalls = 0;
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: heard.join(' '),
    words: heard.map((word, index) => ({ w: word, start: index, end: index + 0.4, p: 0.95 })),
  }));
  mock.method(transcriptionVerifier, 'verifyPhonemeBuffer', async () => {
    phonemeCalls += 1;
    return { ok: false, decision: 'reject', ctcScore: -9, similarity: 0 };
  });
  try {
    const res = await transcriptionVerifier.verifyChunk(
      makePcm16Wav(6),
      'We introduce two important parameters',
      {
        dictionaryWords: ['parameters'],
        dictionaryEntries: [{ word: 'parameters', arpabet: 'P ER0 AE1 M AH0 T ER0 Z' }],
        finalWordTailCheck: true,
      },
    );
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(phonemeCalls, 0);
    assert.deepEqual(res.phonemeAssessments, []);
  } finally {
    mock.restoreAll();
  }
});

test('an uncertain phoneme result cannot forgive a Whisper-mismatched technical word', async () => {
  const heard = 'Km or the mccallus constant describes enzyme kinetics'.split(' ');
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: heard.join(' '),
    words: heard.map((word, index) => ({
      w: word,
      start: index,
      end: index + Math.max(0.24, word.length * 0.06),
      p: 0.9,
    })),
  }));
  mock.method(transcriptionVerifier, 'verifyPhonemeBuffer', async () => ({
    ok: false,
    inconclusive: true,
    decision: 'uncertain',
    expected: 'm aɪ k eɪ l ɪ s',
    observed: 'm aɪ k l ɪ s',
    ctcScore: -3.2,
    similarity: 0.45,
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      makePcm16Wav(9),
      'Km or the Michaelis constant describes enzyme kinetics',
      {
        dictionaryWords: ['michaelis'],
        dictionaryEntries: [{ word: 'michaelis', arpabet: 'M AY K EY L IH S' }],
        finalWordTailCheck: true,
      },
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.deepEqual(res.forgivenDictionaryWords, []);
    assert.equal(res.phonemeAssessments[0].decision, 'uncertain');
  } finally {
    mock.restoreAll();
  }
});

test('Live Full does not forgive a hallucinated technical timestamp over silence', async () => {
  const heard = 'Km or the mccallus constant describes enzyme kinetics'.split(' ');
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: heard.join(' '),
    words: heard.map((word, index) => ({
      w: word,
      start: index,
      end: index + Math.max(0.24, word.length * 0.06),
      p: 0.9,
    })),
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      makePcm16Wav(9, [{ start: 3, end: 3.6 }]),
      'Km or the Michaelis constant describes enzyme kinetics',
      { dictionaryWords: ['michaelis'], finalWordTailCheck: true },
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.deepEqual(res.forgivenDictionaryWords, []);
  } finally {
    mock.restoreAll();
  }
});

test('Live Full does not timing-forgive a hard dictionary word when its aligned slot is absent', async () => {
  const heard = 'Km or the constant describes enzyme kinetics'.split(' ');
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: heard.join(' '),
    words: heard.map((word, index) => ({
      w: word,
      start: index,
      end: index + Math.max(0.24, word.length * 0.06),
      p: 0.9,
    })),
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'Km or the Michaelis constant describes enzyme kinetics',
      { dictionaryWords: ['michaelis'], finalWordTailCheck: true },
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.deepEqual(res.forgivenDictionaryWords, []);
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

test('trailing dict word dropped from a long chunk is NOT forgiven (no 10% slack)', async () => {
  // Real regression: "...divide very fast and unregulated" dropped its last two words.
  // The old 90% count slack tolerated 2 drops in an 18-word chunk, so "unregulated"
  // (a dict word) was forgiven and never re-rolled. A net token drop must fail the gate.
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'At another end of the spectrum of cell division tumor cells in contrast divide very fast',
    words: [],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'At another end of the spectrum of cell division, tumor cells, in contrast, divide very fast and unregulated.',
      { dictionaryWords: ['unregulated'] },
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.ok(res.missingWords.includes('unregulated'), JSON.stringify(res));
  } finally {
    mock.restoreAll();
  }
});

test('common dictionary words are not forgiven when a phrase is missing', async () => {
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'At another end of the spectrum of cell division tumor cells in contrast',
    words: [],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'At another end of the spectrum of cell division, tumor cells, in contrast, divide very fast and unregulated.',
      { dictionaryWords: ['divide', 'very', 'fast'] },
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.ok(res.missingWords.includes('divide'), JSON.stringify(res));
    assert.ok(res.missingWords.includes('very'), JSON.stringify(res));
    assert.ok(res.missingWords.includes('fast'), JSON.stringify(res));
  } finally {
    mock.restoreAll();
  }
});

test('missing four-letter content words force a re-roll', async () => {
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'tumor cells in contrast divide and unregulated',
    words: [],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'tumor cells in contrast divide very fast and unregulated',
      {},
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.ok(res.missingWords.includes('very'), JSON.stringify(res));
    assert.ok(res.missingWords.includes('fast'), JSON.stringify(res));
  } finally {
    mock.restoreAll();
  }
});

test('one and a half is accepted when Whisper writes 1.5', async () => {
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'They double every 1.5 to 3 hours while bacteria divide every 20 minutes',
    words: [],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'They double every one and a half to three hours, while bacteria divide every twenty minutes.',
      {},
    );
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(res.missingWords, []);
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

test('Live Full rejects the same low-confidence word and chooses another take', async () => {
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'the daughter centriole respectively',
    words: [w('the', 0.2), w('daughter', 0.5, 0.1), w('centriole', 0.5), w('respectively', 0.6)],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'the daughter centriole respectively',
      { finalWordTailCheck: true },
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.ok(res.suspectWords.includes('daughter'), JSON.stringify(res));
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

test('a doubled substantial word rejects the take (Live Fast repeat defect)', async () => {
  // The model re-read "the patient" — coverage is still 100% (every word present),
  // but a substantial word is heard twice. This must reject so the chunk re-seeds.
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'the patient the patient was given antibiotics',
    words: [],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'the patient was given antibiotics',
      {},
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.ok(res.extraWords.includes('patient'), JSON.stringify(res));
  } finally {
    mock.restoreAll();
  }
});

test('a consecutively doubled word rejects even when it is short', async () => {
  // "the the" back-to-back is a real stutter/double-read, not ASR noise — the
  // consecutive-repeat gate rejects it regardless of word length.
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'the the cell divides quickly',
    words: [],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'the cell divides quickly',
      {},
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.ok(res.repeatedPhrases.includes('the'), JSON.stringify(res));
  } finally {
    mock.restoreAll();
  }
});

test('a NON-consecutive stray duplicate does not force a re-roll', async () => {
  // Whisper heard an extra "cell" elsewhere in the transcript (hallucinated or
  // merged); with no back-to-back repeat this is not the double-read defect.
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'the cell divides quickly into a new cell',
    words: [],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'the cell divides quickly into a new one',
      {},
    );
    assert.equal(res.ok, true, JSON.stringify(res));
  } finally {
    mock.restoreAll();
  }
});

test('a doubled phrase with a number word rejects (cell one cell one)', async () => {
  // Number words are uncountable for the surplus check, so only the consecutive-
  // repeat gate can see this — the signature double-read defect.
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'open cell one cell one now',
    words: [],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'open cell one now',
      {},
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.ok(res.repeatedPhrases.length > 0, JSON.stringify(res));
  } finally {
    mock.restoreAll();
  }
});

test('an intentional double in the source text does not re-roll (hi hi)', async () => {
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'hi hi welcome back',
    words: [],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'hi hi welcome back',
      {},
    );
    assert.equal(res.ok, true, JSON.stringify(res));
  } finally {
    mock.restoreAll();
  }
});

test('Live Full gates on a missing SHORT content word that Live Fast tolerates', async () => {
  // "cell" dropped: 4 letters already gated everywhere, so use a 3-letter word.
  // Live Full (finalWordTailCheck) rejects any countable missing word; Live Fast
  // keeps the ≥4 threshold and lets coverage decide.
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'the sample was heated in the laboratory chamber overnight for testing',
    words: [],
  }));
  try {
    const expected = 'the wet sample was heated in the laboratory chamber overnight for testing';
    const fast = await transcriptionVerifier.verifyChunk(Buffer.alloc(0), expected, {});
    assert.equal(fast.ok, true, JSON.stringify(fast));
    const full = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      expected,
      { finalWordTailCheck: true },
    );
    assert.equal(full.ok, false, JSON.stringify(full));
    assert.ok(full.missingWords.includes('wet'), JSON.stringify(full));
  } finally {
    mock.restoreAll();
  }
});

test('Live Full has no word-length exemption and rejects a missing one-letter word', async () => {
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'this is complete sentence for the strict verifier today',
    words: [],
  }));
  try {
    const expected = 'this is a complete sentence for the strict verifier today';
    const fast = await transcriptionVerifier.verifyChunk(Buffer.alloc(0), expected, {});
    assert.equal(fast.ok, true, JSON.stringify(fast));
    const full = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      expected,
      { finalWordTailCheck: true },
    );
    assert.equal(full.ok, false, JSON.stringify(full));
    assert.ok(full.missingWords.includes('a'), JSON.stringify(full));
  } finally {
    mock.restoreAll();
  }
});

test('a CLIPPED dict word (chromatin->chroma) is NOT forgiven on Live Full/Queue', async () => {
  // The model cut "chromatin" to "chroma". Token count holds and the head has audio, so
  // the count/timing gates would wrongly forgive it. finalWordTailCheck (Live Full/Queue)
  // engages the truncation check: a heard token that is a strict prefix of the dict word
  // means it was cut short → reject and re-roll.
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'the chroma condenses during mitosis',
    words: [],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'the chromatin condenses during mitosis',
      { dictionaryWords: ['chromatin'], finalWordTailCheck: true },
    );
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.ok(res.missingWords.includes('chromatin'), JSON.stringify(res));
  } finally {
    mock.restoreAll();
  }
});

test('the same clipped dict word stays forgiven on Live Fast (no tail check)', async () => {
  // Scoping guard: without finalWordTailCheck (Live Fast) the truncation rejection does
  // not run, so behavior is unchanged there — the change is Live Full/Queue only.
  mock.method(transcriptionVerifier, 'transcribeBuffer', async () => ({
    text: 'the chroma condenses during mitosis',
    words: [],
  }));
  try {
    const res = await transcriptionVerifier.verifyChunk(
      Buffer.alloc(0),
      'the chromatin condenses during mitosis',
      { dictionaryWords: ['chromatin'] },
    );
    assert.equal(res.ok, true, JSON.stringify(res));
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
