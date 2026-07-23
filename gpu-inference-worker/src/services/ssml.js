// SSML-lite preprocessing, applied BEFORE the pronunciation dictionary and text
// normalization on the Live Full paths. Only the tags that map cleanly onto the
// existing pipeline (and therefore add ZERO audio-quality risk AND do not fight the
// ASR word-coverage verifier) are supported:
//
//   <say-as interpret-as="characters">MRI</say-as> -> letter-by-letter spell-out
//   <break time="500ms"/> | <break strength="strong"/> -> a real inter-chunk pause
//
// <break> is turned into a private-use sentinel that rides along on the chunk text
// and is later read by the concatenation stage, which already knows how to insert a
// deterministic, click-free silence between chunks. So a break becomes actual
// digital silence, not a spoken word, and needs no new audio code.
//
// <sub> is deliberately NOT supported: substituting a word for a differently-spelled
// alias (e.g. "metformin" -> "met for min") makes the ASR verifier hear the real word
// back from the audio and flag every alias token as "missing", forcing false retries.
// Hard-word pronunciation goes through the ARPAbet pronunciation dictionary instead,
// which keeps the real word in the text (so verification/retry/anti-drop all work) and
// overrides only the g2p. A stray <sub> tag falls back to speaking the real word.
//
// Everything else the model would otherwise read aloud (unknown tags, <phoneme>,
// <prosody>, <emphasis>, <sub>, angle brackets) has its TAGS stripped (inner text
// kept) so raw markup is never spoken. <phoneme>/<prosody>/<emphasis> are not
// interpreted: they need audio post-processing or unreliable tricks that degrade
// quality — the ARPAbet dictionary is the supported path for phoneme control.

import { renderSpellout } from './emphasisAndSpelling.js';

// Private-use sentinel wrapping a break's millisecond value: <ms>.
// PUA chars survive every downstream text transform (none of the normalizers touch
// U+E100..) and the bare digits inside are left alone too, so the token reaches the
// chunker intact. Kept internal — callers use extractBreakMs()/stripBreakSentinels().
const BREAK_OPEN = '\uE100';
const BREAK_CLOSE = '\uE101';
export const BREAK_SENTINEL_RE = new RegExp(`${BREAK_OPEN}(\\d+)${BREAK_CLOSE}`, 'u');
const BREAK_SENTINEL_RE_G = new RegExp(`${BREAK_OPEN}(\\d+)${BREAK_CLOSE}`, 'gu');

// Clamp so a typo like time="500s" (= 500000ms) can't stall a passage, but high
// enough to allow deliberately long narration pauses (up to 10s).
const MAX_BREAK_MS = 10000;

// SSML <break strength="..."> keyword -> milliseconds (W3C-ish defaults).
const STRENGTH_MS = {
  none: 0,
  'x-weak': 100,
  weak: 200,
  medium: 400,
  strong: 700,
  'x-strong': 1000,
};

function makeBreakSentinel(ms) {
  const clamped = Math.max(0, Math.min(MAX_BREAK_MS, Math.round(ms)));
  if (clamped === 0) return ' ';
  return ` ${BREAK_OPEN}${clamped}${BREAK_CLOSE} `;
}

function parseBreakMs(attrs) {
  const time = /time\s*=\s*"([^"]*)"/iu.exec(attrs);
  if (time) {
    const raw = time[1].trim().toLowerCase();
    const m = /^([\d.]+)\s*(ms|s)?$/u.exec(raw);
    if (m) {
      const value = Number.parseFloat(m[1]);
      if (Number.isFinite(value)) return m[2] === 's' ? value * 1000 : value;
    }
    return 0;
  }
  const strength = /strength\s*=\s*"([^"]*)"/iu.exec(attrs);
  if (strength) {
    const key = strength[1].trim().toLowerCase();
    return key in STRENGTH_MS ? STRENGTH_MS[key] : STRENGTH_MS.medium;
  }
  return STRENGTH_MS.medium; // bare <break/> = a medium pause
}

// Detect the interpret-as modes that mean "spell it out letter by letter".
function isCharacterSpellout(attrs) {
  const m = /interpret-as\s*=\s*"([^"]*)"/iu.exec(attrs);
  if (!m) return false;
  const mode = m[1].trim().toLowerCase();
  return mode === 'characters' || mode === 'spell-out';
}

export function containsSsml(text) {
  return /<\s*(say-as|break)\b/iu.test(String(text || ''));
}

// Normalized dictionary key for a wrapped word: uppercased, stripped to A-Z0-9'. An
// empty result (multi-word or symbol-only inner) never matches a dictionary term.
function dictKey(inner) {
  const trimmed = String(inner || '').trim();
  if (/\s/u.test(trimmed)) return ''; // multi-word: not a single dictionary term
  return trimmed.toUpperCase().replace(/[^A-Z0-9']/gu, '');
}

/**
 * Expand supported SSML-lite tags into plain text (+ break sentinels). Safe to call
 * on non-SSML text: with no tags it only strips stray angle-bracket markup, which is
 * never something the model should read aloud anyway.
 *
 * ARPAbet dictionary entries take priority: if a <say-as> wraps a word that has an
 * ARPAbet override (passed in options.protectedWords, an uppercased Set), the tag is
 * IGNORED and the original word is kept so the precise g2p override applies and the
 * retry / chunk-tail / verification logic still recognizes the real word.
 */
export function expandSsml(text, { protectedWords = null } = {}) {
  let result = String(text || '');
  const isProtected = (inner) => {
    if (!protectedWords || protectedWords.size === 0) return false;
    const key = dictKey(inner);
    return key !== '' && protectedWords.has(key);
  };

  // <say-as interpret-as="characters">MRI</say-as> -> "M R I". Any other
  // interpret-as mode falls back to the inner text unchanged (safe default). An
  // ARPAbet-dictionary word keeps its original form so the g2p override wins.
  result = result.replace(
    /<\s*say-as\b([^>]*)>([\s\S]*?)<\s*\/\s*say-as\s*>/giu,
    (_m, attrs, inner) => {
      if (isProtected(inner)) return ` ${inner} `;
      return isCharacterSpellout(attrs) ? ` ${renderSpellout(inner)} ` : ` ${inner} `;
    },
  );

  // <break .../> -> sentinel carrying the pause in ms.
  result = result.replace(
    /<\s*break\b([^>]*)\/?\s*>/giu,
    (_m, attrs) => makeBreakSentinel(parseBreakMs(attrs)),
  );

  // Strip any remaining markup so unsupported/raw tags are never spoken.
  result = result.replace(/<[^>]+>/gu, ' ');

  return result.replace(/[ \t]{2,}/gu, ' ').trim();
}

// True when the text carries a trailing break sentinel (a break requested right at
// this chunk's boundary). Only a TRAILING sentinel controls the inter-chunk gap.
export function extractBreakMs(chunkText) {
  const trimmed = String(chunkText || '').trimEnd();
  const m = new RegExp(`${BREAK_OPEN}(\\d+)${BREAK_CLOSE}$`, 'u').exec(trimmed);
  return m ? Number.parseInt(m[1], 10) : null;
}

// Remove every break sentinel (used before the text reaches the model / ASR / SSE).
export function stripBreakSentinels(text) {
  return String(text || '').replace(BREAK_SENTINEL_RE_G, ' ').replace(/[ \t]{2,}/gu, ' ').trim();
}

// Convert internal sentinels back to editable SSML-lite markup for review textareas.
// The model/ASR never sees this form; it is only a lossless user-facing rendering.
export function renderBreakSentinels(text) {
  return String(text || '').replace(
    BREAK_SENTINEL_RE_G,
    (_match, ms) => `<break time="${ms}ms"/>`,
  ).replace(/[ \t]{2,}/gu, ' ').trim();
}

// Split text into segments at each break sentinel. Returns
// [{ text, breakMsAfter }] where breakMsAfter is the pause (ms) requested right after
// that segment, or null for the final segment. Used by the chunker to force a chunk
// boundary at every break so the sentinel always rides on a chunk tail.
export function splitOnBreaks(text) {
  // String.split with a capturing group keeps the captured ms values, and split
  // ignores the regex's global flag, so a non-global capturing pattern splits on all.
  const parts = String(text || '').split(BREAK_SENTINEL_RE);
  const segments = [];
  for (let i = 0; i < parts.length; i += 2) {
    const raw = parts[i + 1];
    segments.push({
      text: parts[i] || '',
      breakMsAfter: raw !== undefined ? Number.parseInt(raw, 10) : null,
    });
  }
  return segments;
}

// Separate silence requested before/after all spoken text from internal breaks.
// Boundary silence cannot be represented by an inter-chunk gap, so callers prepend
// or append it directly to the finished WAV. Consecutive breaks are additive, with
// the same 10-second safety cap used for a single break.
export function partitionBreaks(text) {
  const segments = splitOnBreaks(text);
  const spokenIndexes = segments
    .map((segment, index) => (String(segment.text || '').trim() ? index : -1))
    .filter(index => index >= 0);
  if (spokenIndexes.length === 0) {
    const total = segments.reduce((sum, segment) => sum + (segment.breakMsAfter || 0), 0);
    return {
      speechText: '',
      leadingBreakMs: Math.min(MAX_BREAK_MS, total),
      trailingBreakMs: 0,
    };
  }

  const first = spokenIndexes[0];
  const last = spokenIndexes[spokenIndexes.length - 1];
  const sumBreaks = (from, to) => Math.min(
    MAX_BREAK_MS,
    segments.slice(from, to).reduce((sum, segment) => sum + (segment.breakMsAfter || 0), 0),
  );
  const leadingBreakMs = sumBreaks(0, first);
  const trailingBreakMs = sumBreaks(last, segments.length);

  let speechText = '';
  for (let index = first; index <= last;) {
    const currentText = String(segments[index].text || '').trim();
    if (currentText) speechText = `${speechText} ${currentText}`.trim();
    let breakMs = segments[index].breakMsAfter || 0;
    let next = index + 1;
    while (next <= last && !String(segments[next].text || '').trim()) {
      breakMs += segments[next].breakMsAfter || 0;
      next += 1;
    }
    if (next <= last && breakMs > 0) {
      speechText = appendBreakSentinel(speechText, Math.min(MAX_BREAK_MS, breakMs));
    }
    index = next;
  }

  return { speechText, leadingBreakMs, trailingBreakMs };
}

// Re-attach a trailing break sentinel to a chunk so the concatenation stage inserts
// the requested silence after it.
export function appendBreakSentinel(text, ms) {
  return `${String(text || '').trimEnd()} ${BREAK_OPEN}${Math.round(ms)}${BREAK_CLOSE}`;
}
