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

// Words we don't hold against a read: pure numerals (Whisper spells them out, so
// "19" vs "nineteen" is a wording mismatch, not a skip) and single characters
// (spelled-out acronym letters render as "E C G" and transcribe unreliably).
function isCountable(token) {
  if (token.length < 2) return false;
  if (/^\p{N}+$/u.test(token)) return false;
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
