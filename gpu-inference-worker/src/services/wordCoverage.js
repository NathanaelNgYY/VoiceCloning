// Decide whether a synthesized chunk actually spoke the words it was given, by
// comparing the intended text against an ASR transcript of the generated audio.
// This is what catches GPT-SoVITS skipping or cutting off words.
//
// Pure + dependency-free so it can be unit-tested without a GPU or Whisper.

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\b(?:one|1)[\s-]+and[\s-]+a[\s-]+half\b/gu, ' oneandahalf ')
    .replace(/\b1[.,]5\b/gu, ' oneandahalf ')
    // Whisper often re-abbreviates spoken units/symbols ("fifty percent" -> "50%",
    // "millimeters of mercury" -> "mmHg"). The synthesis text is expanded to words
    // (textPronunciation), so undo the abbreviation here or every such read would
    // look like it dropped the word and force a needless re-roll.
    .replace(/%/gu, ' percent ')
    .replace(/\bmmhg\b/gu, ' millimeters of mercury ')
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
// Total spoken-word token count. A SKIP removes a token; a MISPRONUNCIATION keeps
// the count (one word in, one (wrong) word out). So comparing expected vs heard
// token counts is a robust "were all the words actually spoken?" signal that does
// NOT depend on Whisper spelling a rare medical term correctly. Used to forgive a
// dictionary word that Whisper mis-transcribed but the model did speak.
export function countWords(text) {
  return tokenize(text).length;
}

function isCountable(token, minWordLength = 2) {
  if (token.length < minWordLength) return false;
  if (/\p{N}/u.test(token)) return false;
  return true;
}

// Whisper writes spoken numbers as digits ("nine" -> "9") and uses its own locale
// spelling ("fibers" -> "fibres"). The intended text doesn't, so a perfectly read
// word looks "missing" and forces a needless re-roll. Canonicalize BOTH the
// expected word and the transcript to a common form before comparing, so these
// purely-orthographic differences stop reading as dropped words. Applied
// symmetrically, so even an imperfect rule still lets identical words match; the
// only risk is mapping two different words together, kept low with length guards.
const NUMBER_WORDS = new Map([
  ['zero', '0'], ['one', '1'], ['two', '2'], ['three', '3'], ['four', '4'],
  ['five', '5'], ['six', '6'], ['seven', '7'], ['eight', '8'], ['nine', '9'],
  ['ten', '10'], ['eleven', '11'], ['twelve', '12'], ['thirteen', '13'],
  ['fourteen', '14'], ['fifteen', '15'], ['sixteen', '16'], ['seventeen', '17'],
  ['eighteen', '18'], ['nineteen', '19'], ['twenty', '20'], ['thirty', '30'],
  ['forty', '40'], ['fifty', '50'], ['sixty', '60'], ['seventy', '70'],
  ['eighty', '80'], ['ninety', '90'], ['hundred', '100'], ['thousand', '1000'],
  ['million', '1000000'],
]);

// Heard-side re-abbreviations mapped back to the words the synthesis text uses
// (textPronunciation expands "5 mg" -> "5 milligrams", "1st" -> "first"). Symmetric
// and exact-token only, so an ordinary word can never be mis-mapped.
const ABBREV_WORDS = new Map([
  ['mg', 'milligrams'], ['mcg', 'micrograms'], ['µg', 'micrograms'],
  ['ml', 'milliliters'], ['kg', 'kilograms'], ['km', 'kilometers'],
  ['cm', 'centimeters'], ['mm', 'millimeters'],
  ['hr', 'hour'], ['hrs', 'hours'], ['mins', 'minutes'],
  ['1st', 'first'], ['2nd', 'second'], ['3rd', 'third'], ['4th', 'fourth'],
  ['5th', 'fifth'], ['6th', 'sixth'], ['7th', 'seventh'], ['8th', 'eighth'],
  ['9th', 'ninth'], ['10th', 'tenth'], ['11th', 'eleventh'], ['12th', 'twelfth'],
]);

function canonicalize(token) {
  if (!token) return token;
  if (NUMBER_WORDS.has(token)) return NUMBER_WORDS.get(token);
  if (ABBREV_WORDS.has(token)) return ABBREV_WORDS.get(token);
  let t = token;
  // British -> American spelling normalization (symmetric on both sides).
  if (t.length >= 6) t = t.replace(/our(s?)$/u, 'or$1');            // colour->color, tumour->tumor
  t = t.replace(/is(e|ed|es|ing|ation)$/u, (_m, suf) => `iz${suf}`); // organise->organize
  t = t.replace(/yse(s|d)?$/u, (_m, suf = '') => `yze${suf}`);       // analyse->analyze
  if (t.length >= 5) t = t.replace(/([bcglmt])re(s?)$/u, '$1er$2');  // centre->center, fibre->fiber
  return t;
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
export function computeWordCoverage(expectedText, transcript, opts = {}) {
  const minWordLength = Number.isFinite(opts.minWordLength)
    ? Math.max(0, opts.minWordLength)
    : 2;
  // Keep the original word for reporting, match on the canonical form.
  const expected = tokenize(expectedText)
    .filter((token) => isCountable(token, minWordLength))
    .map((raw) => ({ raw, key: canonicalize(raw) }));
  if (expected.length === 0) {
    return { coverage: 1, missingWords: [], expectedCount: 0, matchedCount: 0 };
  }

  let actual = tokenize(transcript).map(canonicalize);
  // The synthesis normalizer deliberately separates some compounds to make the
  // voice pronounce them clearly ("through out"), while Whisper normally joins
  // the spoken result back into one token ("throughout"). Re-expand only when an
  // actual token is the exact concatenation of adjacent expected tokens. This is
  // narrower than lowering the generic absorbed-fragment length and cannot turn
  // an unrelated substring into coverage for a missing short word.
  const expectedKeysInOrder = expected.map((entry) => entry.key);
  actual = actual.flatMap((actualToken) => {
    for (let width = Math.min(4, expectedKeysInOrder.length); width >= 2; width -= 1) {
      for (let start = 0; start + width <= expectedKeysInOrder.length; start += 1) {
        const fragments = expectedKeysInOrder.slice(start, start + width);
        if (fragments.join('') === actualToken) return fragments;
      }
    }
    return [actualToken];
  });
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

  const expectedKeys = new Set(expected.map((e) => e.key));

  for (const { raw, key } of expected) {
    let foundIndex = -1;
    // Prefer an exact, unconsumed match; fall back to a fuzzy one.
    for (let i = 0; i < actual.length; i++) {
      if (!consumed[i] && actual[i] === key) { foundIndex = i; break; }
    }
    if (foundIndex === -1) {
      for (let i = 0; i < actual.length; i++) {
        if (!consumed[i] && isFuzzyMatch(key, actual[i])) { foundIndex = i; break; }
      }
    }
    if (foundIndex === -1) {
      if (isAbsorbedFragment(key)) {
        matchedCount += 1;
        continue;
      }
      missingWords.push(raw);
    } else {
      consumed[foundIndex] = true;
      matchedCount += 1;
    }
  }

  // Extra words = leftover transcript tokens that are a SURPLUS occurrence of an
  // intended word (heard more times than the text contains it). This is the
  // signature of a double-read — GPT-SoVITS re-speaking a word or phrase — which
  // coverage alone can't see, because every expected word is still present. Only a
  // surplus of an EXPECTED word counts: a stray ASR token that was never in the text
  // is left alone (a hallucinated insertion is not the defect we gate on, and gating
  // on it would cause false re-rolls). Numbers/single letters are excluded via
  // isCountable, matching the coverage side.
  const extraWords = [];
  for (let i = 0; i < actual.length; i++) {
    if (consumed[i]) continue;
    const token = actual[i];
    if (!isCountable(token)) continue;
    if (expectedKeys.has(token)) extraWords.push(token);
  }

  return {
    coverage: matchedCount / expected.length,
    missingWords,
    extraWords,
    expectedCount: expected.length,
    matchedCount,
  };
}

/**
 * Detect a stutter/double-read: a word or short phrase spoken back-to-back MORE
 * times than the text itself repeats it ("cell one cell one" for a single
 * "cell one"; "hi hi hi" for "hi hi"). This replaces gating on the multiset
 * surplus of expected words, which couldn't tell a real double-read apart from a
 * stray ASR duplicate elsewhere in the transcript — and, inversely, missed doubled
 * number words ("one one") that the surplus check excludes as uncountable. Only
 * CONSECUTIVE repetition beyond the text's own consecutive repetition is flagged,
 * so intentional doubles in the source ("very, very") never re-roll. Digits are
 * included on purpose: a doubled "one" is exactly the defect this catches.
 *
 * @returns {string[]} repeated phrases (canonical form), empty when clean
 */
export function findRepeatedPhrases(expectedText, transcript, opts = {}) {
  const maxNgram = Number.isFinite(opts.maxNgram) ? opts.maxNgram : 3;
  const actual = tokenize(transcript).map(canonicalize);
  const expected = tokenize(expectedText).map(canonicalize);

  // Longest back-to-back run of `gram` anywhere in `tokens`.
  const maxConsecutiveRun = (tokens, gram) => {
    const n = gram.length;
    let best = 0;
    for (let i = 0; i + n <= tokens.length; i += 1) {
      let run = 0;
      let j = i;
      while (j + n <= tokens.length && gram.every((t, k) => tokens[j + k] === t)) {
        run += 1;
        j += n;
      }
      if (run > best) best = run;
    }
    return best;
  };

  const flagged = [];
  const seen = new Set();
  for (let n = 1; n <= maxNgram; n += 1) {
    for (let i = 0; i + 2 * n <= actual.length; i += 1) {
      let repeats = true;
      for (let k = 0; k < n; k += 1) {
        if (actual[i + n + k] !== actual[i + k]) { repeats = false; break; }
      }
      if (!repeats) continue;
      const gram = actual.slice(i, i + n);
      const phrase = gram.join(' ');
      // Single letters repeat legitimately in spelled-out acronyms ("E E G" et al.)
      // and are too noisy to gate on.
      if (phrase.replace(/\s/gu, '').length < 2) continue;
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      if (maxConsecutiveRun(actual, gram) > Math.max(1, maxConsecutiveRun(expected, gram))) {
        flagged.push(phrase);
      }
    }
  }
  return flagged;
}

// A dictionary word may only be "forgiven" as a harmless mis-transcription when it
// was actually SPOKEN in full — not when the model cut it short. When GPT-SoVITS clips
// "chromatin" to "chroma" or "environment" to "environ", Whisper writes the shorter
// token, which is a strict PREFIX of the expected word. That is a truncation (the head
// was said, the tail dropped), not a spelling slip, so it must stay un-forgiven and
// re-roll. A genuine mis-transcription ("centriole" -> "central") is NOT a prefix of the
// expected word, so it is still forgiven. This closes the hole where the exact medical
// terms admins add to the dictionary were the ones whose clips got masked.
export function isTruncatedDictWord(expectedWord, transcript) {
  const key = canonicalize(String(expectedWord || '').toLowerCase());
  if (key.length < 5) return false; // too short to call a truncation reliably
  for (const token of tokenize(transcript).map(canonicalize)) {
    if (token.length < 3 || token === key) continue;
    // Strict prefix AND materially shorter = the word's head was spoken, tail cut off.
    // 0.85 clears real clips (chroma 6/9≈0.67, environ 7/11≈0.64) without tripping on a
    // near-complete read.
    if (key.startsWith(token) && token.length < key.length * 0.85) return true;
  }
  return false;
}

// A substantial word the model is most likely to clip. Words shorter than this are
// too noisy to judge on timing/confidence. Set to 4 so short content words like
// "very", "fast", "cell", and "rate" are tracked for retry too.
const MIN_SCRUTINY_LENGTH = 4;
const NUMERIC_UNITS = new Set([
  'second', 'seconds',
  'minute', 'minutes',
  'hour', 'hours',
  'day', 'days',
  'week', 'weeks',
  'month', 'months',
  'year', 'years',
]);

function isNumericKey(key) {
  return key === 'oneandahalf' || /^\d+$/u.test(key);
}

/**
 * Positionally confirm a (mis-transcribed) word was actually SPOKEN, using Whisper
 * word timings. Coverage's dictionary forgiveness leans on a whole-chunk token count,
 * which a stray ASR hallucination can refill even when a word was dropped. This adds a
 * per-word check: map the word's position among the expected tokens proportionally
 * into the heard-word sequence and require a nearby heard token with real audio under
 * it. A long dictionary term renders as a substantial span, so a genuine skip (near-
 * zero span) is NOT confirmed and stays un-forgiven. Corroborating only — used to
 * TIGHTEN forgiveness, never to reject on its own.
 *
 * @param {string} expectedText
 * @param {string} targetWord
 * @param {Array<{start:number,end:number}>} words - ASR word timing data
 * @param {object} opts
 * @returns {boolean}
 */
export function findWordTimingEvidence(expectedText, targetWord, words = [], opts = {}) {
  const minDuration = Number.isFinite(opts.minDuration) ? opts.minDuration : 0.12;
  const minProbability = Number.isFinite(opts.minProbability) ? opts.minProbability : 0.35;
  const minWordLength = Number.isFinite(opts.minWordLength) ? Math.max(0, opts.minWordLength) : 2;
  const target = canonicalize(String(targetWord || '').toLowerCase());
  if (!target || !Array.isArray(words) || words.length === 0) return null;

  const expected = tokenize(expectedText)
    .filter((token) => isCountable(token, minWordLength))
    .map(canonicalize);
  const idx = expected.indexOf(target);
  if (idx === -1 || expected.length === 0) return null;

  const actual = words.map((entry) => ({
    token: canonicalize(tokenize(entry.w)[0] || ''),
    start: Number(entry.start),
    end: Number(entry.end),
    duration: Math.max(0, Number(entry.end) - Number(entry.start)),
    probability: Number.isFinite(entry.p) ? entry.p : 1,
  })).filter((entry) => entry.token);
  if (actual.length === 0) return null;

  const tokensMatch = (a, b) => a === b || isFuzzyMatch(a, b);
  let beforeExpected = -1;
  let beforeActual = -1;
  for (let e = idx - 1; e >= 0 && beforeExpected === -1; e -= 1) {
    for (let a = actual.length - 1; a >= 0; a -= 1) {
      if (tokensMatch(expected[e], actual[a].token)) {
        beforeExpected = e;
        beforeActual = a;
        break;
      }
    }
  }

  let afterExpected = expected.length;
  let afterActual = actual.length;
  for (let e = idx + 1; e < expected.length; e += 1) {
    const start = Math.max(0, beforeActual + 1);
    const found = actual.findIndex((entry, a) => a >= start && tokensMatch(expected[e], entry.token));
    if (found !== -1) {
      afterExpected = e;
      afterActual = found;
      break;
    }
  }

  const expectedGap = afterExpected - beforeExpected - 1;
  const actualGap = afterActual - beforeActual - 1;
  // A technical-word substitution keeps a real timed token in the same anchored
  // slot. If the heard gap is shorter, something was actually omitted; never use a
  // neighbouring word's healthy timing as evidence for the missing target.
  if (expectedGap <= 0 || actualGap < expectedGap) return null;
  const relativeOffset = idx - beforeExpected - 1;
  const candidateOffset = expectedGap === 1
    ? Math.floor((actualGap - 1) / 2)
    : Math.round((relativeOffset / (expectedGap - 1)) * Math.max(0, actualGap - 1));
  const candidate = actual[beforeActual + 1 + candidateOffset];
  return candidate
    && candidate.duration >= minDuration
    && candidate.probability >= minProbability
    && Number.isFinite(candidate.start)
    && Number.isFinite(candidate.end)
    ? candidate
    : null;
}

export function isWordSpokenByTiming(expectedText, targetWord, words = [], opts = {}) {
  return Boolean(findWordTimingEvidence(expectedText, targetWord, words, opts));
}

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
  // Absolute floor on a word's spoken duration. This is the signal that catches a
  // SKIPPED word Whisper hallucinated back from context (coverage passes, so no
  // other check fires): the hallucinated word has no real audio under it, so
  // Whisper gives it a near-zero / absurdly tiny span. No genuinely-spoken word —
  // even "a" or "or" — lasts under ~50 ms, so this almost never false-positives,
  // and unlike the per-char check it applies to words of ANY length.
  const minWordDuration = Number.isFinite(opts.minWordDuration) ? opts.minWordDuration : 0.05;

  // Match against ALL countable expected words (not just long ones): a skipped
  // short word ("or", "is") is exactly what the absolute-duration check must see.
  // Keep the original word (for reporting + length-based scrutiny), match on canon.
  const minWordLength = Number.isFinite(opts.minWordLength)
    ? Math.max(0, opts.minWordLength)
    : 2;
  const allExpected = tokenize(expectedText)
    .map((raw) => ({ raw, key: canonicalize(raw), countable: isCountable(raw, minWordLength) }));
  const expected = allExpected
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => entry.countable);
  if (expected.length === 0 || !Array.isArray(words) || words.length === 0) {
    return { suspectWords: [], skippedWords: [] };
  }

  const actual = words.map((entry) => ({
    token: canonicalize(tokenize(entry.w)[0] || ''),
    duration: Math.max(0, Number(entry.end) - Number(entry.start)),
    probability: Number.isFinite(entry.p) ? entry.p : 1,
  })).filter((entry) => entry.token);

  const consumed = new Array(actual.length).fill(false);
  const suspectWords = [];
  const skippedWords = [];

  // The FINAL expected word gets extra scrutiny: GPT-SoVITS's AR decoder sometimes
  // emits end-of-sequence a beat early, half-saying the word right before the full
  // stop. Mid-chunk the both-signals (short AND low-confidence) rule is right, but at
  // the chunk tail a clipped word can keep moderate confidence (Whisper completes it
  // from context), so require less to force a re-roll there. Thresholds stay well
  // below a briskly-but-fully spoken word so complete takes aren't re-rolled.
  //
  // Opt-in via finalWordTailCheck: this is meaningful only where a chunk ends on a
  // sentence boundary — the Live Full / Live Full Queue paths, which split into
  // sentence-ended chunks. Live Fast's "chunk" is a whole client-side phrase, so its
  // final word is just the reply's last word (not a per-sentence tail) and the extra
  // scrutiny would only add needless re-rolls; it leaves the flag off.
  const finalWordTailCheck = Boolean(opts.finalWordTailCheck);
  const finalExpectedIndex = expected[expected.length - 1].index;
  // The FIRST expected word gets the same scrutiny: the model's onset can start a
  // beat late and clip the chunk-opening word's head, and (like the tail case)
  // Whisper completes it from context with moderate confidence, so the strict
  // both-signals rule misses it. Same conservative thresholds, same opt-in flag.
  const firstExpectedIndex = expected[0].index;
  const minFinalWordDuration = Number.isFinite(opts.minFinalWordDuration) ? opts.minFinalWordDuration : 0.12;

  // Live Full / Queue uses zero length-based exemption: every alphabetic word that
  // reaches this verifier is scrutinized, including one-letter "a". Live Fast keeps
  // the established ≥4 timing/confidence gate for latency and ASR-noise tolerance.
  const scrutinyLength = finalWordTailCheck ? 0 : MIN_SCRUTINY_LENGTH;

  for (const { raw, key, index } of expected) {
    let foundIndex = -1;
    for (let i = 0; i < actual.length; i++) {
      if (!consumed[i] && actual[i].token === key) { foundIndex = i; break; }
    }
    if (foundIndex === -1) {
      for (let i = 0; i < actual.length; i++) {
        if (!consumed[i] && isFuzzyMatch(key, actual[i].token)) { foundIndex = i; break; }
      }
    }
    if (foundIndex === -1) continue; // fully missing — that's the coverage check's job

    consumed[foundIndex] = true;
    const match = actual[foundIndex];

    // skippedSpan = near-zero audio under the word: the model never really spoke it
    // and Whisper hallucinated it back from context. Reliable hard skip on its own.
    const skippedSpan = match.duration < minWordDuration;

    // tooShort and tooQuiet are each NOISY alone — a briskly-spoken COMPLETE word
    // looks "too short" (Whisper's word boundaries are fuzzy), and a rare COMPLETE
    // word gets low confidence. Using either alone re-rolled fully-correct takes
    // endlessly. But a genuine HALF-CUT word is BOTH: short audio AND low confidence
    // (Whisper is unsure precisely because the audio doesn't cover the whole word).
    // So the half-cut hard signal requires BOTH together, which fires on real cuts
    // without flagging complete words. Each signal alone stays advisory (scoring).
    const longEnough = raw.length >= scrutinyLength;
    const tooShort = longEnough && match.duration > 0 && match.duration / raw.length < minSecPerChar;
    const tooQuiet = longEnough && match.probability < minProbability;
    const halfCut = tooShort && tooQuiet;
    const previous = allExpected[index - 1];
    const numericUnit = NUMERIC_UNITS.has(key) && previous && isNumericKey(previous.key);
    const weakNumericUnit = numericUnit && (
      match.duration < 0.18 ||
      match.probability < 0.72
    );

    // Final-word tail-cut: hard signal at the chunk tail only. Either an absolute
    // duration floor (no full ≥4-char word fits in <120ms) or a relaxed short+unsure
    // pair (per-char span low AND confidence merely middling, vs. the strict pair
    // above). Both stay conservative enough that a complete final word passes.
    const finalWordCut = finalWordTailCheck
      && (index === finalExpectedIndex || index === firstExpectedIndex)
      && longEnough && (
        match.duration < minFinalWordDuration
        || (match.duration / raw.length < 0.04 && match.probability < 0.6)
      );

    if (skippedSpan || halfCut || weakNumericUnit || finalWordCut) skippedWords.push(raw);
    if (skippedSpan || tooShort || tooQuiet || weakNumericUnit || finalWordCut) suspectWords.push(raw);
  }

  return { suspectWords, skippedWords };
}
