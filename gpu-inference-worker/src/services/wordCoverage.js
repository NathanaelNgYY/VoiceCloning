// Decide whether a synthesized chunk actually spoke the words it was given, by
// comparing the intended text against an ASR transcript of the generated audio.
// This is what catches GPT-SoVITS skipping or cutting off words.
//
// Pure + dependency-free so it can be unit-tested without a GPU or Whisper.

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    // keep letters, digits and intra-word apostrophes; everything else is a break
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/(^|\s)'+|'+(\s|$)/gu, '$1$2')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

// Words we don't hold against a read, because ASR can't reliably confirm them and
// would produce false "missing" flags:
//   - single characters (spelled-out acronym letters render as "E C G")
//   - anything containing a digit: pure numerals (Whisper spells "19" as
//     "nineteen") AND alphanumeric codes / IDs like "nct01675856", which Whisper
//     mangles even when the audio is correct.
function isCountable(token) {
  if (token.length < 2) return false;
  if (/\p{N}/u.test(token)) return false;
  return true;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

// Two words count as the same if they match exactly or are close enough to be an
// ASR spelling slip rather than a different word. Tolerance scales with length.
function isFuzzyMatch(expected, actual) {
  if (expected === actual) return true;
  const maxLen = Math.max(expected.length, actual.length);
  if (maxLen <= 3) return false; // short words: require exact
  const tolerance = maxLen <= 6 ? 1 : 2;
  return levenshtein(expected, actual) <= tolerance;
}

/**
 * Compute how completely `transcript` covers the countable words of `expectedText`.
 * Order-insensitive multiset match (handles repeats), with fuzzy matching so minor
 * ASR misspellings don't read as drops.
 *
 * @returns {{ coverage: number, missingWords: string[], expectedCount: number, matchedCount: number }}
 *   coverage is 1 when there are no countable expected words.
 */
export function computeWordCoverage(expectedText, transcript) {
  const expected = tokenize(expectedText).filter(isCountable);
  if (expected.length === 0) {
    return { coverage: 1, missingWords: [], expectedCount: 0, matchedCount: 0 };
  }

  const actual = tokenize(transcript);
  const consumed = new Array(actual.length).fill(false);
  const missingWords = [];
  let matchedCount = 0;

  // A word is "absorbed" when it appears in the space-stripped transcript but is
  // NOT itself a standalone transcript token. This reconciles the two ways the
  // pronunciation dictionary and Whisper disagree on word boundaries — without it
  // every such term reads as a false skip:
  //   - dictionary split a hard word ("endoscopy" -> "endos copy") and Whisper
  //     wrote it whole ("endoscopy" contains both "endos" and "copy");
  //   - the source ran words together ("ClinicalTrials") and Whisper split them
  //     ("clinical trials", whose join contains "clinicaltrials").
  // Excluding standalone tokens means a repeated plain word ("very very" vs a
  // single "very") is still correctly counted as one match, not absorbed.
  const actualTokenSet = new Set(actual);
  const joinedActual = actual.join('');
  const isAbsorbedFragment = (word) => (
    word.length >= 4 && !actualTokenSet.has(word) && joinedActual.includes(word)
  );

  for (const word of expected) {
    let foundIndex = -1;
    // Prefer an exact, unconsumed match; fall back to a fuzzy one.
    for (let i = 0; i < actual.length; i++) {
      if (!consumed[i] && actual[i] === word) { foundIndex = i; break; }
    }
    if (foundIndex === -1) {
      for (let i = 0; i < actual.length; i++) {
        if (!consumed[i] && isFuzzyMatch(word, actual[i])) { foundIndex = i; break; }
      }
    }
    if (foundIndex === -1) {
      if (isAbsorbedFragment(word)) {
        matchedCount += 1;
        continue;
      }
      missingWords.push(word);
    } else {
      consumed[foundIndex] = true;
      matchedCount += 1;
    }
  }

  return {
    coverage: matchedCount / expected.length,
    missingWords,
    expectedCount: expected.length,
    matchedCount,
  };
}

// A long word the model is most likely to clip. Short words are too noisy to
// judge on timing/confidence, so we only scrutinize substantial ones (medical
// terms tend to be long, which is exactly the at-risk case).
const MIN_SCRUTINY_LENGTH = 6;

/**
 * Detect words that were probably spoken only partway ("half-said then skipped").
 * Whisper transcribes such a word in full from context, so it passes coverage —
 * but the audio it aligned to is short and/or low-confidence. We flag an expected
 * content word when its aligned transcript word is below a probability floor OR
 * its spoken span is implausibly short for its length.
 *
 * @param {string} expectedText
 * @param {Array<{w:string,start:number,end:number,p:number}>} words - ASR word data
 * @param {object} opts
 * @returns {{ suspectWords: string[] }}
 */
export function findClippedWords(expectedText, words = [], opts = {}) {
  // Confidence is the RELIABLE clip signal: a half-said or mispronounced word is
  // low-confidence, while a fast-but-complete word stays high-confidence. We lean
  // on it (0.45) and treat timing as only a coarse backstop, because per-word
  // duration false-positives on briskly-spoken common words ("there", "phase",
  // "protein") — flagging complete sentences as clipped and rejecting good takes.
  const minProbability = Number.isFinite(opts.minProbability) ? opts.minProbability : 0.45;
  // Seconds of audio per character below which a word was almost certainly cut
  // short. Natural speech is ~0.06-0.09 s/char, but a quick common word can dip
  // well below that WITHOUT being clipped — so keep this low (0.03) to catch only
  // egregiously short spans and let confidence handle the rest.
  const minSecPerChar = Number.isFinite(opts.minSecPerChar) ? opts.minSecPerChar : 0.03;

  const expected = tokenize(expectedText).filter((t) => isCountable(t) && t.length >= MIN_SCRUTINY_LENGTH);
  if (expected.length === 0 || !Array.isArray(words) || words.length === 0) {
    return { suspectWords: [] };
  }

  const actual = words.map((entry) => ({
    token: tokenize(entry.w)[0] || '',
    duration: Math.max(0, Number(entry.end) - Number(entry.start)),
    probability: Number.isFinite(entry.p) ? entry.p : 1,
  })).filter((entry) => entry.token);

  const consumed = new Array(actual.length).fill(false);
  const suspectWords = [];

  for (const word of expected) {
    let foundIndex = -1;
    for (let i = 0; i < actual.length; i++) {
      if (!consumed[i] && actual[i].token === word) { foundIndex = i; break; }
    }
    if (foundIndex === -1) {
      for (let i = 0; i < actual.length; i++) {
        if (!consumed[i] && isFuzzyMatch(word, actual[i].token)) { foundIndex = i; break; }
      }
    }
    if (foundIndex === -1) continue; // fully missing — that's the coverage check's job

    consumed[foundIndex] = true;
    const match = actual[foundIndex];
    const tooQuiet = match.probability < minProbability;
    const tooShort = match.duration > 0 && match.duration / word.length < minSecPerChar;
    if (tooQuiet || tooShort) suspectWords.push(word);
  }

  return { suspectWords };
}
