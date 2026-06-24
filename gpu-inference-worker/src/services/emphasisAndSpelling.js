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
  if (!/^[A-Z]+$/u.test(word)) return 'plain';      // must be bare ALL-CAPS letters
  const upper = word.toUpperCase();
  if (acronyms.has(upper)) return 'spellout';
  if (!isRealWord(word)) return 'spellout';
  return 'emphasis';
}

export function applyEmphasisAndSpelling(text, options = {}) {
  let result = String(text || '');

  // 1. Explicit dotted spell-out, uppercase only so lowercase abbreviations
  //    (e.g., i.e., a.m.) are left untouched: W.H.O.  E.C.G.  U.S.A.
  result = result.replace(/\b([A-Z](?:\.[A-Z])+\.?)/gu, (m) => renderSpellout(m));

  // 2. Explicit space-separated single capitals: W H O  E C G
  result = result.replace(/\b([A-Z](?:\s+[A-Z])+)\b/gu, (m) => renderSpellout(m));

  // 3. Bare alphabetic words: emphasis vs. auto spell-out vs. plain.
  result = result.replace(/[A-Za-z]+/gu, (word) => {
    const kind = classifyWord(word, options);
    if (kind === 'spellout') return renderSpellout(word);
    if (kind === 'emphasis') return renderEmphasis(word);
    return word;
  });

  // 4. Clean up pause-punctuation artifacts introduced by emphasis bracketing.
  result = result
    .replace(/\s+,/gu, ',')              // space before comma
    .replace(/,\s*,/gu, ',')             // doubled commas
    .replace(/,(\s*[.!?;:])/gu, '$1')    // comma glued to terminal/clause punctuation
    .replace(/(^|[.!?]\s*),\s*/gu, '$1') // comma right after a sentence start
    .replace(/[ \t]{2,}/gu, ' ');

  return result;
}
