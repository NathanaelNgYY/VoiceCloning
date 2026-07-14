import { ACRONYM_OVERRIDES } from './acronymOverrides.js';
import { isRealWord as defaultIsRealWord } from './cmuDictionary.js';

// Spell-out renders as uppercase letters separated by single spaces, matching the
// format GPT-SoVITS already pronounces correctly in production today.
export function renderSpellout(letters) {
  return String(letters).replace(/[^A-Za-z]/gu, '').toUpperCase().split('').join(' ');
}

// Emphasis is purely prosodic: bracket the (lowercased) word with comma pauses so
// the model sets it apart. The caps were just an authoring marker.
export function renderEmphasis(word) {
  return `, ${String(word).toLowerCase()},`;
}

export function classifyWord(word, { acronyms = ACRONYM_OVERRIDES, isRealWord = defaultIsRealWord } = {}) {
  if (!word || word.length < 2) return 'plain';
  if (!/^[A-Z]+$/u.test(word)) return 'plain';      // must be bare ALL-CAPS letters (no digits)
  const upper = word.toUpperCase();
  if (acronyms.has(upper)) return 'spellout';
  if (!isRealWord(word)) return 'spellout';
  return 'emphasis';
}

export function applyEmphasisAndSpelling(text, options = {}) {
  let result = String(text || '');

  // 1. Explicit dotted spell-out, uppercase only so lowercase abbreviations
  //    (e.g., i.e., a.m.) are left untouched: W.H.O.  E.C.G.  U.S.A.
  result = result.replace(/\b([A-Z](?:\.[A-Z])+\.?)/gu, (m, _initialism, offset, source) => {
    const remainder = source.slice(offset + m.length);
    const hasFinalDot = m.endsWith('.');
    // The last dot in "F.A.D. Another sentence" serves both as acronym punctuation
    // and as the sentence terminator. Keep one terminal dot when the initialism ends
    // the input or the following text looks like a new sentence. Mid-sentence forms
    // such as "W.H.O. guidance" still lose all internal pause-heavy periods.
    const endsSentence = hasFinalDot && (
      remainder.trim() === ''
      || /^\s*[\r\n]/u.test(remainder)
      || /^\s+["'“‘(\[]*[A-Z0-9]/u.test(remainder)
    );
    return `${renderSpellout(m)}${endsSentence ? '.' : ''}`;
  });

  // 2. Explicit space-separated single capitals: W H O  E C G
  result = result.replace(/\b([A-Z](?:\s+[A-Z])+)\b/gu, (m) => renderSpellout(m));

  // 3. Bare word tokens: emphasis vs. auto spell-out vs. plain. Match the whole
  //    alphanumeric token so mixed tokens (HTML5, T2DM) are captured intact and
  //    left untouched — only PURE-alpha caps tokens are transformed (classifyWord
  //    rejects anything with a digit).
  result = result.replace(/[A-Za-z][A-Za-z0-9]*/gu, (word) => {
    const kind = classifyWord(word, options);
    if (kind === 'spellout') return renderSpellout(word);
    if (kind === 'emphasis') return renderEmphasis(word);
    return word;
  });

  // 4. Clean up pause-punctuation artifacts from emphasis bracketing. These rules
  //    must NEVER remove whitespace adjacent to sentence-terminal punctuation
  //    (.!?), or longTextInference's sentence splitter fuses words across the
  //    boundary.

  // 4a. Comma glued before terminal/clause punctuation: "stop ,!" -> "stop!".
  result = result.replace(/,(?=\s*[.!?;:])/gu, '');

  // 4b. Space before a comma, but only when the char before the space is NOT
  //     sentence-terminal punctuation (so ". , stop" keeps its space).
  result = result.replace(/([^.!?\s])\s+,/gu, '$1,');

  // 4c. Drop a leading emphasis comma at string start or right after .!?, keeping
  //     the existing whitespace so the sentence boundary survives.
  result = result.replace(/(^|[.!?])(\s*),\s*/gu, '$1$2');

  // 4d. Collapse comma runs to a single comma, idempotently (loop to fixed point).
  let prev;
  do {
    prev = result;
    result = result.replace(/,\s*,/gu, ',');
  } while (result !== prev);

  // 4e. Collapse stray multi-spaces/tabs (never newlines).
  result = result.replace(/[ \t]{2,}/gu, ' ');

  return result;
}
