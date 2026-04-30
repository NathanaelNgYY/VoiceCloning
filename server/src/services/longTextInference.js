import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { inferenceServer } from './inferenceServer.js';
import { sseManager } from './sseManager.js';
import { inferenceState } from './inferenceState.js';
import { TEMP_DIR } from '../config.js';
import { isS3Mode, uploadBuffer } from './s3Storage.js';

// Track active streaming sessions for cancellation
const activeSessions = new Map(); // sessionId -> { cancelled: boolean }

const DEFAULTS = {
  maxChunkLength: 280,
  maxSentencesPerChunk: 3,
  chunkJoinPauseMs: 120,
  retryCount: 2,
};

function clampNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

// Compound words that the TTS model mispronounces as a single token.
// Each entry maps a word (case-insensitive) to its split form.
// Add new entries here as you discover mispronounced words.
const COMPOUND_WORD_SPLITS = {
  // General academic
  audiobook: 'audio book',
  audiobooks: 'audio books',
  textbook: 'text book',
  textbooks: 'text books',
  notebook: 'note book',
  notebooks: 'note books',
  handbook: 'hand book',
  handbooks: 'hand books',
  coursework: 'course work',
  framework: 'frame work',
  frameworks: 'frame works',
  workflow: 'work flow',
  workflows: 'work flows',
  feedback: 'feed back',
  outcome: 'out come',
  outcomes: 'out comes',
  overview: 'over view',
  throughout: 'through out',
  widespread: 'wide spread',
  breakthrough: 'break through',
  breakthroughs: 'break throughs',
  underlying: 'under lying',
  overlapping: 'over lapping',
  mainstream: 'main stream',
  standalone: 'stand alone',
  // Medical — anatomy & body
  bloodstream: 'blood stream',
  bloodwork: 'blood work',
  heartbeat: 'heart beat',
  heartburn: 'heart burn',
  breastbone: 'breast bone',
  backbone: 'back bone',
  kneecap: 'knee cap',
  eardrum: 'ear drum',
  eyeball: 'eye ball',
  eyelid: 'eye lid',
  fingertip: 'finger tip',
  footprint: 'foot print',
  windpipe: 'wind pipe',
  birthmark: 'birth mark',
  // Medical — conditions & symptoms
  headache: 'head ache',
  headaches: 'head aches',
  backache: 'back ache',
  toothache: 'tooth ache',
  stomachache: 'stomach ache',
  nosebleed: 'nose bleed',
  sunburn: 'sun burn',
  heatstroke: 'heat stroke',
  frostbite: 'frost bite',
  outbreak: 'out break',
  outbreaks: 'out breaks',
  onset: 'on set',
  setback: 'set back',
  setbacks: 'set backs',
  fallout: 'fall out',
  flareup: 'flare up',
  burnout: 'burn out',
  // Medical — procedures & treatment
  healthcare: 'health care',
  aftercare: 'after care',
  bloodtest: 'blood test',
  checkup: 'check up',
  checkups: 'check ups',
  followup: 'follow up',
  followups: 'follow ups',
  bypass: 'by pass',
  cutoff: 'cut off',
  cutoffs: 'cut offs',
  dosage: 'dose age',
  intake: 'in take',
  output: 'out put',
  uptake: 'up take',
  lifespan: 'life span',
  timeframe: 'time frame',
  timeframes: 'time frames',
  guideline: 'guide line',
  guidelines: 'guide lines',
  baseline: 'base line',
  // Medical — pharmacology & research
  drugstore: 'drug store',
  painkiller: 'pain killer',
  painkillers: 'pain killers',
  antibiotic: 'anti biotic',
  antibiotics: 'anti biotics',
  underdose: 'under dose',
  overdose: 'over dose',
  overdoses: 'over doses',
  sideeffect: 'side effect',
  // Laboratory & research
  benchmark: 'bench mark',
  benchmarks: 'bench marks',
  counterpart: 'counter part',
  counterparts: 'counter parts',
  dataset: 'data set',
  datasets: 'data sets',
  database: 'data base',
  databases: 'data bases',
  screenshot: 'screen shot',
  screenshots: 'screen shots',
  // Lecture / education
  classroom: 'class room',
  classrooms: 'class rooms',
  homework: 'home work',
  bookshelf: 'book shelf',
  whiteboard: 'white board',
  whiteboards: 'white boards',
  blackboard: 'black board',
  slideshow: 'slide show',
  powerpoint: 'power point',
  worksheet: 'work sheet',
  worksheets: 'work sheets',
  undergraduate: 'under graduate',
  undergraduates: 'under graduates',
  postgraduate: 'post graduate',
  postgraduates: 'post graduates',
};

function splitCompoundWords(text) {
  const pattern = new RegExp(
    `\\b(${Object.keys(COMPOUND_WORD_SPLITS).join('|')})\\b`,
    'gi',
  );
  return text.replace(pattern, (match) => {
    return COMPOUND_WORD_SPLITS[match.toLowerCase()] || match;
  });
}

// ── Number-to-words helpers ──

const NUM_ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const NUM_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const NUM_ORDINAL_ONES = [
  '', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth',
  'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth',
  'seventeenth', 'eighteenth', 'nineteenth',
];
const NUM_ORDINAL_TENS = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];

function twoDigitWords(n) {
  if (n < 20) return NUM_ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? NUM_TENS[t] : `${NUM_TENS[t]}-${NUM_ONES[o]}`;
}

function cardinalWords(n) {
  if (n === 0) return 'zero';
  if (n < 20) return NUM_ONES[n];
  if (n < 100) return twoDigitWords(n);
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    const base = `${NUM_ONES[h]} hundred`;
    return r === 0 ? base : `${base} and ${twoDigitWords(r)}`;
  }
  // "Fifteen hundred" form for 1100-1900 divisible by 100
  if (n >= 1100 && n <= 1900 && n % 100 === 0) {
    return `${twoDigitWords(n / 100)} hundred`;
  }
  if (n < 1000000) {
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    const base = `${cardinalWords(th)} thousand`;
    if (r === 0) return base;
    if (r < 100) return `${base} and ${cardinalWords(r)}`;
    return `${base} ${cardinalWords(r)}`;
  }
  return String(n);
}

function ordinalWords(n) {
  if (n < 20) return NUM_ORDINAL_ONES[n] || `${cardinalWords(n)}th`;
  if (n < 100) {
    if (n % 10 === 0) return NUM_ORDINAL_TENS[Math.floor(n / 10)];
    return `${NUM_TENS[Math.floor(n / 10)]}-${NUM_ORDINAL_ONES[n % 10]}`;
  }
  // For n >= 100: build cardinal prefix for hundreds and add ordinal suffix for the remainder
  const remainder = n % 100;
  const hundredsPrefix = `${NUM_ONES[Math.floor(n / 100)]} hundred`;
  if (remainder === 0) return `${hundredsPrefix}th`;
  if (remainder < 20) return `${hundredsPrefix} and ${NUM_ORDINAL_ONES[remainder]}`;
  const tens = Math.floor(remainder / 10);
  const ones = remainder % 10;
  if (ones === 0) return `${hundredsPrefix} and ${NUM_ORDINAL_TENS[tens]}`;
  return `${hundredsPrefix} and ${NUM_TENS[tens]}-${NUM_ORDINAL_ONES[ones]}`;
}

function yearWords(n) {
  if (n === 2000) return 'two thousand';
  if (n >= 2001 && n <= 2009) return `two thousand and ${NUM_ONES[n % 10]}`;
  if (n >= 2010) return `twenty ${twoDigitWords(n - 2000)}`;
  const high = Math.floor(n / 100);
  const low = n % 100;
  if (low === 0) return `${twoDigitWords(high)} hundred`;
  return `${twoDigitWords(high)} ${twoDigitWords(low)}`;
}

function currencyWords(amountStr) {
  const cleaned = amountStr.replace(/,/g, '');
  const [intPart, decPart = '0'] = cleaned.split('.');
  const dollars = parseInt(intPart, 10) || 0;
  const cents = parseInt(decPart.padEnd(2, '0').slice(0, 2), 10);
  const dollarWord = dollars === 1 ? 'dollar' : 'dollars';
  const centWord = cents === 1 ? 'cent' : 'cents';
  if (cents === 0) return `${cardinalWords(dollars)} ${dollarWord}`;
  if (dollars === 0) return `${cardinalWords(cents)} ${centWord}`;
  return `${cardinalWords(dollars)} ${dollarWord} and ${cardinalWords(cents)} ${centWord}`;
}

export function normalizeNumbers(text) {
  let result = text;

  // 1. Ordinals: 1st, 2nd, 3rd … 21st, 22nd …
  result = result.replace(/\b(\d{1,3})(st|nd|rd|th)\b/gi, (_, n) => ordinalWords(parseInt(n, 10)));

  // 2. Currency: $50, $3.50, $1,500
  result = result.replace(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\b/g, (_, amount) => currencyWords(amount));

  // 3. Decimal numbers: 3.14, 0.5 (must run before year/cardinal steps)
  result = result.replace(/\b(\d+)\.(\d+)\b/g, (_, int, dec) =>
    `${cardinalWords(parseInt(int, 10))} point ${dec.split('').map(d => NUM_ONES[parseInt(d, 10)] || d).join(' ')}`
  );

  // 4. Years 1000–2099 (standalone 4-digit numbers in that range)
  result = result.replace(/\b(1[0-9]{3}|20[0-9]{2})\b/g, (_, yr) => yearWords(parseInt(yr, 10)));

  // 5. Comma-separated numbers: 1,500 / 10,000
  result = result.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (_, n) =>
    cardinalWords(parseInt(n.replace(/,/g, ''), 10))
  );

  // 6. Remaining plain integers up to 4 digits
  result = result.replace(/\b(\d{1,4})\b/g, (_, n) => cardinalWords(parseInt(n, 10)));

  return result;
}

// ── Text preprocessing: abbreviations, acronyms, symbols ──

const ABBREVIATIONS = {
  'Dr.': 'Doctor',
  'Mr.': 'Mister',
  'Mrs.': 'Misses',
  'Prof.': 'Professor',
  'Sr.': 'Senior',
  'Jr.': 'Junior',
  'vs.': 'versus',
  'etc.': 'etcetera',
  'approx.': 'approximately',
  'dept.': 'department',
  'govt.': 'government',
  'no.': 'number',
  'nos.': 'numbers',
  'vol.': 'volume',
  'esp.': 'especially',
};

// Build a single regex that matches any abbreviation at a word boundary.
// We escape the dots and sort longest-first so "nos." doesn't shadow "no.".
const abbrPattern = new RegExp(
  '(?<=^|\\s)(' +
  Object.keys(ABBREVIATIONS)
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/\./g, '\\.'))
    .join('|') +
  ')(?=\\s|$)',
  'gi',
);

// Words that happen to be all-caps but should NOT be letter-spaced
const ACRONYM_SKIP = new Set([
  'I', 'A', 'AM', 'PM', 'OK', 'OH', 'OR', 'IF', 'IN', 'IT', 'IS',
  'AT', 'AN', 'AS', 'BE', 'BY', 'DO', 'GO', 'HE', 'ME', 'MY', 'NO',
  'OF', 'ON', 'SO', 'TO', 'UP', 'US', 'WE',
]);

const SYMBOL_MAP = {
  '@': 'at',
  '&': 'and',
  '#': 'number',
  '%': 'percent',
  '+': 'plus',
  '=': 'equals',
};

const symbolPattern = new RegExp(
  '(?<=\\s|^)([' + Object.keys(SYMBOL_MAP).map(s => '\\' + s).join('') + '])(?=\\s|$)',
  'g',
);

export function preprocessText(text) {
  let result = text;

  // 0) Number normalisation (years, ordinals, currency, cardinals)
  result = normalizeNumbers(result);

  // 1) Abbreviation expansion
  result = result.replace(abbrPattern, (match) => {
    // Lookup is case-insensitive — normalise the key to title case for the map
    for (const [abbr, expansion] of Object.entries(ABBREVIATIONS)) {
      if (abbr.toLowerCase() === match.toLowerCase()) return expansion;
    }
    return match;
  });

  // 2) Acronym / initialism spacing (2-5 uppercase letters at word boundaries)
  result = result.replace(/\b([A-Z]{2,5})\b/g, (match) => {
    if (ACRONYM_SKIP.has(match)) return match;
    return match.split('').join(' ');
  });

  // 3) Symbol expansion
  result = result.replace(symbolPattern, (match) => SYMBOL_MAP[match] || match);

  return result;
}

function normalizeWhitespace(text) {
  const cleaned = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(\w)-(\w)/g, '$1 $2')   // "real-time" → "real time" so TTS won't say "minus"
    .trim();
  return splitCompoundWords(cleaned);
}

// Common multi-word phrases that should not be split across chunks
const SEMANTIC_UNITS = [
  'of the', 'in the', 'to the', 'for the', 'on the', 'at the', 'by the',
  'to a', 'of a', 'in a', 'for a', 'on a',
  'it is', 'that is', 'there is', 'this is', 'it was', 'that was', 'there was',
  'as well', 'such as', 'due to', 'in order', 'as a',
  'would be', 'could be', 'should be', 'will be', 'has been', 'have been',
  'do not', 'does not', 'did not', 'is not', 'was not', 'are not',
];

const NBSP = '\u00A0'; // non-breaking space used as internal sentinel

function protectSemanticUnits(text) {
  let result = text;
  for (const phrase of SEMANTIC_UNITS) {
    // Replace normal spaces within the phrase with NBSP (case-insensitive)
    const pattern = new RegExp(phrase.replace(/ /g, ' '), 'gi');
    result = result.replace(pattern, (match) => match.replace(/ /g, NBSP));
  }
  return result;
}

function restoreSemanticUnits(text) {
  return text.replace(/\u00A0/g, ' ');
}

function splitIntoSentences(text) {
  const preprocessed = preprocessText(String(text || ''));
  const normalized = normalizeWhitespace(preprocessed);
  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[.!?。！？…:：;；,，])\s+|(?<=—)\s*(?=\S)|\n+/u)
    .map(part => part.trim())
    .filter(Boolean);

  if (sentences.length > 0) return sentences;
  return [normalized];
}

function splitLongSentence(sentence, maxChunkLength) {
  if (sentence.length <= maxChunkLength) return [sentence];

  // Protect semantic units before splitting
  const protected_ = protectSemanticUnits(sentence);

  const parts = [];
  let remaining = protected_.trim();
  const minCut = Math.floor(maxChunkLength * 0.6);

  // Priority tiers for split points
  const clauseSeparators = [';', ':', '；', '：'];      // clause boundaries (preferred)
  const commaSeparators = [',', '，'];                   // comma breaks (fallback)

  while (remaining.length > maxChunkLength) {
    const searchWindow = remaining.slice(0, maxChunkLength + 1);
    let cut = -1;

    // Tier 1: prefer clause-level separators
    for (const sep of clauseSeparators) {
      const idx = searchWindow.lastIndexOf(sep);
      if (idx > cut) cut = idx;
    }

    // Tier 2: fall back to comma if clause separator was too early
    if (cut < minCut) {
      for (const sep of commaSeparators) {
        const idx = searchWindow.lastIndexOf(sep);
        if (idx > cut) cut = idx;
      }
    }

    // Tier 3: break at a normal space (never at NBSP — that's a protected unit)
    if (cut < minCut) {
      cut = searchWindow.lastIndexOf(' ');
    }

    // Tier 4: hard cut at max length
    if (cut < minCut) {
      cut = maxChunkLength;
    }

    const slice = remaining.slice(0, cut + (cut === maxChunkLength ? 0 : 1)).trim();
    parts.push(restoreSemanticUnits(slice));
    remaining = remaining.slice(cut + (cut === maxChunkLength ? 0 : 1)).trim();
  }

  if (remaining) parts.push(restoreSemanticUnits(remaining));
  return parts.filter(Boolean);
}

export function splitTextIntoChunks(text, options = {}) {
  const maxChunkLength = Math.max(80, clampNumber(options.maxChunkLength, DEFAULTS.maxChunkLength));
  const maxSentencesPerChunk = Math.max(1, clampNumber(options.maxSentencesPerChunk, DEFAULTS.maxSentencesPerChunk));

  const rawSentences = splitIntoSentences(text).flatMap(sentence => splitLongSentence(sentence, maxChunkLength));
  const chunks = [];
  let current = '';
  let sentenceCount = 0;

  for (const sentence of rawSentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    const exceedsLength = candidate.length > maxChunkLength;
    const exceedsSentenceCount = sentenceCount >= maxSentencesPerChunk;

    if (current && (exceedsLength || exceedsSentenceCount)) {
      chunks.push(current.trim());
      current = sentence;
      sentenceCount = 1;
    } else {
      current = candidate;
      sentenceCount += 1;
    }

    // Force a chunk boundary after any pause-worthy punctuation so silence is inserted between chunks
    const trimmed = current.trimEnd();
    const lastChar = trimmed.slice(-1);
    const endsWithEllipsis = trimmed.endsWith('...') || trimmed.endsWith('\u2026');
    if (trimmed && (endsWithEllipsis || '.!?。！？:：;；,，—'.includes(lastChar))) {
      chunks.push(trimmed);
      current = '';
      sentenceCount = 0;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function readChunk(buffer, offset) {
  if (offset + 8 > buffer.length) return null;
  const id = buffer.toString('ascii', offset, offset + 4);
  const size = buffer.readUInt32LE(offset + 4);
  const start = offset + 8;
  const end = start + size;
  if (end > buffer.length) return null;
  return { id, size, start, end, next: end + (size % 2) };
}

export function parseWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
    throw new Error('Invalid WAV buffer');
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Expected a RIFF/WAVE audio buffer');
  }

  let offset = 12;
  let fmtChunk = null;
  let dataChunk = null;

  while (offset + 8 <= buffer.length) {
    const chunk = readChunk(buffer, offset);
    if (!chunk) break;
    if (chunk.id === 'fmt ') {
      fmtChunk = buffer.slice(chunk.start, chunk.end);
    } else if (chunk.id === 'data') {
      dataChunk = buffer.slice(chunk.start, chunk.end);
    }
    offset = chunk.next;
  }

  if (!fmtChunk || !dataChunk) {
    throw new Error('WAV file is missing fmt or data chunk');
  }

  return {
    audioFormat: fmtChunk.readUInt16LE(0),
    numChannels: fmtChunk.readUInt16LE(2),
    sampleRate: fmtChunk.readUInt32LE(4),
    byteRate: fmtChunk.readUInt32LE(8),
    blockAlign: fmtChunk.readUInt16LE(12),
    bitsPerSample: fmtChunk.readUInt16LE(14),
    fmtChunk,
    dataChunk,
  };
}

function buildWav(fmtChunk, dataChunk) {
  const riffSize = 4 + (8 + fmtChunk.length) + (8 + dataChunk.length);
  const output = Buffer.alloc(12 + 8 + fmtChunk.length + 8 + dataChunk.length);

  output.write('RIFF', 0, 4, 'ascii');
  output.writeUInt32LE(riffSize, 4);
  output.write('WAVE', 8, 4, 'ascii');

  output.write('fmt ', 12, 4, 'ascii');
  output.writeUInt32LE(fmtChunk.length, 16);
  fmtChunk.copy(output, 20);

  const dataHeaderOffset = 20 + fmtChunk.length;
  output.write('data', dataHeaderOffset, 4, 'ascii');
  output.writeUInt32LE(dataChunk.length, dataHeaderOffset + 4);
  dataChunk.copy(output, dataHeaderOffset + 8);

  return output;
}

/**
 * Normalize PCM16 chunk data so peak amplitude hits targetPeak (~-3dB at 0.7).
 * Prevents volume jumps between chunks. Skips if already close or silent.
 */
function normalizeChunkPeak(data, targetPeak = 0.7) {
  const bytesPerSample = 2;
  const sampleCount = Math.floor(data.length / bytesPerSample);
  if (sampleCount === 0) return;

  let absPeak = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = Math.abs(data.readInt16LE(i * bytesPerSample));
    if (sample > absPeak) absPeak = sample;
  }

  // Skip if effectively silent or already within 2% of target
  if (absPeak < 100) return;
  const currentPeak = absPeak / 32767;
  if (Math.abs(currentPeak - targetPeak) / targetPeak < 0.02) return;

  const scale = targetPeak / currentPeak;
  for (let i = 0; i < sampleCount; i++) {
    const offset = i * bytesPerSample;
    const sample = data.readInt16LE(offset);
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * scale))), offset);
  }
}

/**
 * Find the nearest zero crossing within searchRange samples from a chunk edge.
 * Returns the sample index of the crossing, or the edge itself if none found.
 * @param {Buffer} data - PCM16 data
 * @param {'start'|'end'} edge - which end to search from
 * @param {number} searchRange - max samples to scan (~1.3ms at 48kHz for 64)
 */
function findZeroCrossing(data, edge, searchRange = 64) {
  const bytesPerSample = 2;
  const totalSamples = Math.floor(data.length / bytesPerSample);
  if (totalSamples < 2) return 0;

  const range = Math.min(searchRange, totalSamples - 1);

  if (edge === 'start') {
    for (let i = 0; i < range; i++) {
      const s0 = data.readInt16LE(i * bytesPerSample);
      const s1 = data.readInt16LE((i + 1) * bytesPerSample);
      if ((s0 >= 0 && s1 < 0) || (s0 < 0 && s1 >= 0)) return i + 1;
    }
    return 0;
  }

  // edge === 'end'
  for (let i = totalSamples - 1; i > totalSamples - 1 - range; i--) {
    const s0 = data.readInt16LE((i - 1) * bytesPerSample);
    const s1 = data.readInt16LE(i * bytesPerSample);
    if ((s0 >= 0 && s1 < 0) || (s0 < 0 && s1 >= 0)) return i;
  }
  return totalSamples;
}

/**
 * Trim a PCM16 chunk buffer to nearest zero crossings at both edges.
 */
function trimToZeroCrossings(data, blockAlign) {
  const bytesPerSample = 2;
  const totalSamples = Math.floor(data.length / bytesPerSample);
  if (totalSamples < 128) return data; // too short to trim

  const startSample = findZeroCrossing(data, 'start');
  const endSample = findZeroCrossing(data, 'end');

  if (startSample === 0 && endSample === totalSamples) return data;

  const startByte = startSample * blockAlign;
  const endByte = endSample * blockAlign;
  if (endByte <= startByte) return data;

  return data.subarray(startByte, endByte);
}

/**
 * Create shaped silence with micro-ramp edges to prevent the "dead zone"
 * perception of digital silence. Adds inaudible noise (amplitude +/-2)
 * in 3ms ramps at both edges.
 */
function createSilenceBytes(durationMs, parsedWav) {
  const frameCount = Math.max(0, Math.round((durationMs / 1000) * parsedWav.sampleRate));
  const byteLength = frameCount * parsedWav.blockAlign;
  const buf = Buffer.alloc(byteLength, 0);

  if (parsedWav.audioFormat !== 1 || parsedWav.bitsPerSample !== 16 || frameCount < 2) return buf;

  const rampFrames = Math.min(frameCount >> 1, Math.round(0.003 * parsedWav.sampleRate)); // 3ms
  const maxAmp = 2; // inaudible

  for (let i = 0; i < rampFrames; i++) {
    const amp = Math.round(maxAmp * (i / rampFrames));
    const val = (i % 2 === 0) ? amp : -amp;
    for (let ch = 0; ch < parsedWav.numChannels; ch++) {
      const offset = i * parsedWav.blockAlign + ch * 2;
      if (offset + 1 < buf.length) buf.writeInt16LE(val, offset);
    }
  }

  for (let i = 0; i < rampFrames; i++) {
    const frameIdx = frameCount - 1 - i;
    const amp = Math.round(maxAmp * (i / rampFrames));
    const val = (i % 2 === 0) ? amp : -amp;
    for (let ch = 0; ch < parsedWav.numChannels; ch++) {
      const offset = frameIdx * parsedWav.blockAlign + ch * 2;
      if (offset + 1 < buf.length) buf.writeInt16LE(val, offset);
    }
  }

  return buf;
}

/**
 * Apply a raised-cosine (Hann window) fade to PCM16 audio data in-place.
 * S-curve fades eliminate the sharp "corner" at boundaries that causes clicks.
 * @param {Buffer} data - raw PCM16 data (modified in-place)
 * @param {number} sampleRate
 * @param {number} numChannels
 * @param {number} fadeMs - fade duration in milliseconds
 * @param {'in'|'out'} direction
 */
function applyFade(data, sampleRate, numChannels, fadeMs, direction) {
  const bytesPerSample = 2; // PCM16
  const blockAlign = numChannels * bytesPerSample;
  const totalFrames = Math.floor(data.length / blockAlign);
  const fadeFrames = Math.min(totalFrames, Math.round((fadeMs / 1000) * sampleRate));
  if (fadeFrames <= 0) return;

  for (let frame = 0; frame < fadeFrames; frame++) {
    const t = frame / fadeFrames;
    const appliedGain = direction === 'in'
      ? 0.5 * (1 - Math.cos(Math.PI * t))
      : 0.5 * (1 + Math.cos(Math.PI * t));
    const frameOffset = direction === 'in'
      ? frame * blockAlign
      : (totalFrames - 1 - frame) * blockAlign;

    for (let ch = 0; ch < numChannels; ch++) {
      const offset = frameOffset + ch * bytesPerSample;
      if (offset + 1 >= data.length) continue;
      const sample = data.readInt16LE(offset);
      data.writeInt16LE(Math.round(sample * appliedGain), offset);
    }
  }
}

// Determine pause duration (ms) based on trailing punctuation of a chunk
function pauseForPunctuation(chunkText, basePauseMs) {
  const trimmed = chunkText.trimEnd();
  const tail = trimmed.slice(-3); // check last few chars for multi-char punctuation
  const last = trimmed[trimmed.length - 1] || '';

  // Ellipsis — trailing thought, moderate pause
  if (tail.includes('...') || tail.includes('\u2026')) return Math.round(basePauseMs * 1.5);
  // Em dash / double dash — brief dramatic pause
  if (last === '\u2014' || tail.includes('--')) return Math.round(basePauseMs * 0.8);
  // Period, question mark, exclamation
  if ('.!?\u3002\uff01\uff1f'.includes(last)) return Math.round(basePauseMs * 1.2);
  // Colon
  if (':\uff1a'.includes(last)) return Math.round(basePauseMs * 1.3);
  // Semicolon
  if (';\uff1b'.includes(last)) return Math.round(basePauseMs * 1.1);
  // Comma — should be brief, not a full pause
  if (',\uff0c'.includes(last)) return Math.round(basePauseMs * 0.7);
  // No terminal punctuation — gentle transition
  return Math.round(basePauseMs * 0.6);
}

// Determine crossfade duration (ms) based on trailing punctuation
function fadeForPunctuation(chunkText) {
  const trimmed = chunkText.trimEnd();
  const tail = trimmed.slice(-3);
  const last = trimmed[trimmed.length - 1] || '';

  if (tail.includes('...') || tail.includes('\u2026')) return 60;
  if (last === '\u2014' || tail.includes('--')) return 40;
  if ('.!?\u3002\uff01\uff1f'.includes(last)) return 30;
  if (':;\uff1a\uff1b'.includes(last)) return 30;
  if (',\uff0c'.includes(last)) return 20;
  return 20; // no punctuation — almost seamless
}

// Build an array of per-gap pause durations from chunk texts
export function computeChunkPauses(chunkTexts, basePauseMs = DEFAULTS.chunkJoinPauseMs) {
  return chunkTexts.slice(0, -1).map(text => pauseForPunctuation(text, basePauseMs));
}

// Build an array of per-gap crossfade durations from chunk texts
export function computeChunkFades(chunkTexts) {
  return chunkTexts.slice(0, -1).map(text => fadeForPunctuation(text));
}

export function concatWavs(buffers, pauseMs = DEFAULTS.chunkJoinPauseMs, fadeDurations = null) {
  if (!Array.isArray(buffers) || buffers.length === 0) {
    throw new Error('No audio buffers to concatenate');
  }

  const parsed = buffers.map(parseWav);
  const first = parsed[0];

  for (const wav of parsed.slice(1)) {
    if (
      wav.audioFormat !== first.audioFormat ||
      wav.numChannels !== first.numChannels ||
      wav.sampleRate !== first.sampleRate ||
      wav.bitsPerSample !== first.bitsPerSample ||
      wav.blockAlign !== first.blockAlign
    ) {
      throw new Error('Cannot concatenate WAV chunks with mismatched audio formats');
    }
  }

  const defaultFadeMs = 25;
  const isPCM16 = first.audioFormat === 1 && first.bitsPerSample === 16;
  const pauses = Array.isArray(pauseMs) ? pauseMs : Array(parsed.length - 1).fill(pauseMs);
  const fades = Array.isArray(fadeDurations) ? fadeDurations : Array(parsed.length - 1).fill(defaultFadeMs);

  const joinedChunks = [];
  parsed.forEach((wav, index) => {
    const chunk = Buffer.from(wav.dataChunk);
    if (isPCM16) {
      normalizeChunkPeak(chunk);
      const fadeIn = index > 0 ? (fades[index - 1] ?? defaultFadeMs) : 0;
      const fadeOut = index < parsed.length - 1 ? (fades[index] ?? defaultFadeMs) : 0;
      if (fadeIn > 0) applyFade(chunk, first.sampleRate, first.numChannels, fadeIn, 'in');
      if (fadeOut > 0) applyFade(chunk, first.sampleRate, first.numChannels, fadeOut, 'out');
    }
    const trimmed = isPCM16 ? trimToZeroCrossings(chunk, first.blockAlign) : chunk;
    joinedChunks.push(trimmed);
    if (index < parsed.length - 1) {
      const gap = pauses[index] ?? DEFAULTS.chunkJoinPauseMs;
      if (gap > 0) joinedChunks.push(createSilenceBytes(gap, first));
    }
  });

  return buildWav(first.fmtChunk, Buffer.concat(joinedChunks));
}

export function analyzeAudioQuality(buffer, expectedText = '') {
  const wav = parseWav(buffer);
  const bytes = wav.dataChunk;
  const bytesPerSample = Math.max(1, wav.bitsPerSample / 8);
  const frameCount = Math.floor(bytes.length / wav.blockAlign);
  const durationSec = frameCount / wav.sampleRate;
  const expectedMinDurationSec = Math.max(0.25, Math.min(12, expectedText.length / 45));

  let sampleCount = 0;
  let absPeak = 0;
  let rmsSum = 0;
  let zeroishCount = 0;
  let clippedCount = 0;

  let currentQuietRun = 0;
  let longestQuietRun = 0;

  if (wav.audioFormat === 1 && wav.bitsPerSample === 16) {
    for (let offset = 0; offset + 1 < bytes.length; offset += bytesPerSample) {
      const sample = bytes.readInt16LE(offset) / 32768;
      const abs = Math.abs(sample);

      absPeak = Math.max(absPeak, abs);
      rmsSum += sample * sample;

      if (abs < 0.002) zeroishCount += 1;
      if (abs > 0.98) clippedCount += 1;

      if (abs < 0.0035) {
        currentQuietRun += 1;
        if (currentQuietRun > longestQuietRun) {
          longestQuietRun = currentQuietRun;
        }
      } else {
        currentQuietRun = 0;
      }

      sampleCount += 1;
    }
  } else if (wav.audioFormat === 3 && wav.bitsPerSample === 32) {
    for (let offset = 0; offset + 3 < bytes.length; offset += bytesPerSample) {
      const sample = bytes.readFloatLE(offset);
      const abs = Math.abs(sample);

      absPeak = Math.max(absPeak, abs);
      rmsSum += sample * sample;

      if (abs < 0.002) zeroishCount += 1;
      if (abs > 0.98) clippedCount += 1;

      if (abs < 0.0035) {
        currentQuietRun += 1;
        if (currentQuietRun > longestQuietRun) {
          longestQuietRun = currentQuietRun;
        }
      } else {
        currentQuietRun = 0;
      }

      sampleCount += 1;
    }
  } else {
    return {
      ok: buffer.length > 44,
      durationSec,
      reason: null,
      metrics: { unsupportedAnalysisFormat: true, bitsPerSample: wav.bitsPerSample, audioFormat: wav.audioFormat },
    };
  }

  const rms = sampleCount > 0 ? Math.sqrt(rmsSum / sampleCount) : 0;
  const zeroishRatio = sampleCount > 0 ? zeroishCount / sampleCount : 1;
  const clippedRatio = sampleCount > 0 ? clippedCount / sampleCount : 0;
  const longestQuietSec = longestQuietRun / wav.sampleRate;

  // Detect repetitive looping patterns by comparing short windows of audio.
  // A looping stutter repeats the same waveform segment many times, yielding
  // high autocorrelation at a short lag.
  let loopScore = 0;
  if (wav.audioFormat === 1 && wav.bitsPerSample === 16 && sampleCount > 0) {
    // Use a window of ~30ms (typical phoneme length) and check correlation
    const windowFrames = Math.round(0.03 * wav.sampleRate);
    const stepFrames = windowFrames;
    const totalWindows = Math.floor(sampleCount / windowFrames);

    if (totalWindows >= 6) {
      let matchingPairs = 0;
      let totalPairs = 0;

      for (let w = 0; w < totalWindows - 1; w++) {
        const offsetA = w * windowFrames * 2; // 2 bytes per sample (PCM16)
        const offsetB = (w + 1) * windowFrames * 2;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < windowFrames; i++) {
          const posA = offsetA + i * 2;
          const posB = offsetB + i * 2;
          if (posA + 1 >= bytes.length || posB + 1 >= bytes.length) break;
          const a = bytes.readInt16LE(posA);
          const b = bytes.readInt16LE(posB);
          dotProduct += a * b;
          normA += a * a;
          normB += b * b;
        }

        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        if (denom > 0) {
          const correlation = dotProduct / denom;
          if (correlation > 0.85) matchingPairs++;
          totalPairs++;
        }
      }

      if (totalPairs > 0) {
        loopScore = matchingPairs / totalPairs;
      }
    }
  }

  let reason = null;
  if (durationSec < expectedMinDurationSec * 0.45) {
    reason = `Audio duration too short for text (${durationSec.toFixed(2)}s)`;
  } else if (rms < 0.003) {
    reason = 'Generated audio is effectively silent';
  } else if (zeroishRatio > 0.995) {
    reason = 'Generated audio contains almost no speech energy';
  } else if (clippedRatio > 0.2) {
    reason = 'Generated audio appears heavily clipped or corrupted';
  } else if (durationSec > 1.2 && longestQuietSec > 2.0) {
    reason = `Generated audio contains a long internal pause (${longestQuietSec.toFixed(2)}s)`;
  } else if (loopScore > 0.6) {
    reason = `Audio appears to contain repetitive looping (score: ${loopScore.toFixed(2)})`;
  }

  return {
    ok: !reason,
    durationSec,
    reason,
    metrics: { rms, absPeak, zeroishRatio, clippedRatio, longestQuietSec, loopScore },
  };
}

function buildAttemptVariants(baseParams, attemptIndex) {
  const safeTemperature = clampNumber(baseParams.temperature, 1);
  const safeTopP = clampNumber(baseParams.top_p, 1);
  const safeTopK = clampNumber(baseParams.top_k, 5);
  const speed = clampNumber(baseParams.speed_factor, 1);

  const baseSeed = baseParams.seed ?? Number.parseInt(crypto.randomUUID().replace(/-/g, '').slice(0, 8), 16);

  const safeRepPenalty = clampNumber(baseParams.repetition_penalty, 1.35);

  const base = {
    ...baseParams,
    aux_ref_audio_paths: baseParams.aux_ref_audio_paths || [],
    seed: baseSeed,
    text_split_method: baseParams.text_split_method || 'cut0',
    batch_size: 1,
    streaming_mode: false,
    split_bucket: true,
    parallel_infer: false,
    fragment_interval: 0.1,
    repetition_penalty: safeRepPenalty,
    speed_factor: speed,
  };

  if (attemptIndex === 0) {
    return base;
  }

  if (attemptIndex === 1) {
    return {
      ...base,
      seed: (baseSeed + 17) >>> 0,
      repetition_penalty: safeRepPenalty + 0.1,
      temperature: Math.max(0.5, safeTemperature * 0.88),
      fragment_interval: 0.12,
    };
  }

  if (attemptIndex === 2) {
    return {
      ...base,
      temperature: Math.max(0.5, safeTemperature * 0.75),
      top_p: Math.min(0.92, safeTopP),
      top_k: Math.max(8, Math.min(safeTopK, 15)),
      fragment_interval: 0.15,
      repetition_penalty: safeRepPenalty + 0.15,
      seed: (baseSeed + 31) >>> 0,
      text_split_method: 'cut4',
    };
  }

  return {
    ...base,
    temperature: 0.5,
    top_p: 0.88,
    top_k: 12,
    fragment_interval: 0.2,
    repetition_penalty: safeRepPenalty + 0.2,
    seed: (baseSeed + 47) >>> 0,
    text_split_method: 'cut1',
    split_bucket: false,
  };
}

/**
 * Split a chunk roughly in half at the nearest sentence/clause boundary.
 * Returns [firstHalf, secondHalf]. If no good split point is found,
 * falls back to splitting at the nearest space.
 */
function splitChunkInHalf(text) {
  const mid = Math.floor(text.length / 2);
  const searchRange = Math.floor(text.length * 0.3);

  // Look for clause/sentence boundaries near the midpoint
  const separators = ['. ', '? ', '! ', '; ', ': ', ', '];
  let bestIdx = -1;
  let bestDist = Infinity;

  for (const sep of separators) {
    let idx = text.indexOf(sep, mid - searchRange);
    while (idx !== -1 && idx <= mid + searchRange) {
      const splitAt = idx + sep.length - 1; // keep punctuation with left half
      const dist = Math.abs(splitAt - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = splitAt;
      }
      idx = text.indexOf(sep, idx + 1);
    }
  }

  // Fallback: split at nearest space
  if (bestIdx < 1 || bestIdx >= text.length - 1) {
    const spaceLeft = text.lastIndexOf(' ', mid);
    const spaceRight = text.indexOf(' ', mid);
    if (spaceLeft > 0) bestIdx = spaceLeft;
    else if (spaceRight > 0) bestIdx = spaceRight;
    else return [text]; // can't split
  }

  const left = text.slice(0, bestIdx + 1).trim();
  const right = text.slice(bestIdx + 1).trim();
  if (!left || !right) return [text];
  return [left, right];
}

async function synthesizeChunkWithRetry(chunkText, baseParams, options = {}) {
  const retryCount = Math.max(0, clampNumber(options.retryCount, DEFAULTS.retryCount));
  let lastError = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const paddedText = `${chunkText.trim()} `;
    const params = buildAttemptVariants({ ...baseParams, text: paddedText }, attempt);
    try {
      const audioBuffer = await inferenceServer.synthesize(params, { timeoutMs: 180000 });
      const analysis = analyzeAudioQuality(audioBuffer, chunkText);
      if (!analysis.ok) {
        throw new Error(analysis.reason);
      }
      return { audioBuffer, analysis, paramsUsed: params, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Chunk synthesis failed');
}

export function cancelSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.cancelled = true;
    return true;
  }
  return false;
}

function getSessionDir(sessionId) {
  return path.join(TEMP_DIR, 'inference', sessionId);
}

export function getSessionFinalPath(sessionId) {
  return path.join(getSessionDir(sessionId), 'final.wav');
}

export function getSessionChunkPath(sessionId, index) {
  return path.join(getSessionDir(sessionId), `chunk_${String(index).padStart(3, '0')}.wav`);
}

export async function synthesizeLongTextStreaming(sessionId, params, options = {}) {
  const chunks = splitTextIntoChunks(params.text, options);
  if (chunks.length === 0) {
    inferenceState.setError('No text to synthesize');
    sseManager.send(sessionId, 'error', { message: 'No text to synthesize' });
    return;
  }

  const sessionDir = getSessionDir(sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const session = { cancelled: false };
  activeSessions.set(sessionId, session);
  const startTime = Date.now();

  sseManager.send(sessionId, 'inference-start', {
    totalChunks: chunks.length,
    chunks: chunks.map((text, index) => ({ index, text })),
  });
  inferenceState.setGenerating({ totalChunks: chunks.length });

  const chunkPaths = [];

  try {
    for (let index = 0; index < chunks.length; index++) {
      if (session.cancelled) {
        sseManager.send(sessionId, 'error', { message: 'Generation cancelled by user' });
        return;
      }

      const chunkText = chunks[index];
      sseManager.send(sessionId, 'chunk-start', {
        index,
        text: chunkText,
        totalChunks: chunks.length,
      });
      inferenceState.setChunkStart({
        index,
        text: chunkText,
        totalChunks: chunks.length,
      });

      const chunkStart = Date.now();
      let chunkBuffers;
      let totalAttempts;

      try {
        const result = await synthesizeChunkWithRetry(chunkText, { ...params, text: chunkText }, options);
        chunkBuffers = [result.audioBuffer];
        totalAttempts = result.attempts;
      } catch (retryErr) {
        // Adaptive retry: split the failed chunk in half and retry sub-chunks
        const subChunks = splitChunkInHalf(chunkText);
        if (subChunks.length < 2) throw retryErr; // can't split further

        sseManager.send(sessionId, 'chunk-split', {
          index,
          originalText: chunkText,
          subChunks,
        });

        chunkBuffers = [];
        totalAttempts = 0;
        for (const sub of subChunks) {
          const subResult = await synthesizeChunkWithRetry(sub, { ...params, text: sub }, options);
          chunkBuffers.push(subResult.audioBuffer);
          totalAttempts += subResult.attempts;
        }
      }

      // Write chunk WAV(s) to disk — concatenate sub-chunks if split occurred
      const chunkBuffer = chunkBuffers.length === 1
        ? chunkBuffers[0]
        : concatWavs(chunkBuffers, DEFAULTS.chunkJoinPauseMs);
      const chunkPath = path.join(sessionDir, `chunk_${String(index).padStart(3, '0')}.wav`);
      fs.writeFileSync(chunkPath, chunkBuffer);
      chunkPaths.push(chunkPath);

      const chunkDuration = (Date.now() - chunkStart) / 1000;
      sseManager.send(sessionId, 'chunk-complete', {
        index,
        totalChunks: chunks.length,
        attempts: totalAttempts,
        durationSec: parseFloat(chunkDuration.toFixed(2)),
      });
      inferenceState.setChunkComplete({
        index,
        totalChunks: chunks.length,
      });
    }

    // Concatenate all chunk WAVs from disk
    const chunkBuffers = chunkPaths.map(p => fs.readFileSync(p));
    const basePause = clampNumber(options.chunkJoinPauseMs, DEFAULTS.chunkJoinPauseMs);
    const pauses = computeChunkPauses(chunks, basePause);
    const fades = computeChunkFades(chunks);
    const finalBuffer = chunkBuffers.length === 1
      ? chunkBuffers[0]
      : concatWavs(chunkBuffers, pauses, fades);

    const finalPath = path.join(sessionDir, 'final.wav');
    fs.writeFileSync(finalPath, finalBuffer);

    // Upload to S3 for persistence (non-blocking — don't fail the session on S3 error)
    let s3Key = null;
    if (isS3Mode()) {
      s3Key = `audio/output/${sessionId}/final.wav`;
      uploadBuffer(s3Key, finalBuffer, 'audio/wav').catch((err) => {
        console.error(`[inference] Failed to upload result to S3: ${err.message}`);
      });
    }

    const totalDuration = (Date.now() - startTime) / 1000;
    sseManager.send(sessionId, 'inference-complete', {
      totalChunks: chunks.length,
      totalDurationSec: parseFloat(totalDuration.toFixed(2)),
      ...(s3Key ? { s3Key } : {}),
    });
    inferenceState.setComplete();
  } catch (err) {
    const status = err.message?.includes('cancelled') ? 'cancelled' : 'error';
    inferenceState.setError(err.message, status);
    sseManager.send(sessionId, 'error', { message: err.message });
  } finally {
    activeSessions.delete(sessionId);
  }
}

export async function synthesizeLongText(params, options = {}) {
  const chunks = splitTextIntoChunks(params.text, options);
  if (chunks.length === 0) {
    throw new Error('No text to synthesize');
  }

  const buffers = [];
  const metadata = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    let chunkBuffers;
    let totalAttempts;
    let lastAnalysis;

    try {
      const result = await synthesizeChunkWithRetry(chunk, { ...params, text: chunk }, options);
      chunkBuffers = [result.audioBuffer];
      totalAttempts = result.attempts;
      lastAnalysis = result.analysis;
    } catch (retryErr) {
      const subChunks = splitChunkInHalf(chunk);
      if (subChunks.length < 2) throw retryErr;

      chunkBuffers = [];
      totalAttempts = 0;
      for (const sub of subChunks) {
        const subResult = await synthesizeChunkWithRetry(sub, { ...params, text: sub }, options);
        chunkBuffers.push(subResult.audioBuffer);
        totalAttempts += subResult.attempts;
        lastAnalysis = subResult.analysis;
      }
    }

    const chunkBuffer = chunkBuffers.length === 1
      ? chunkBuffers[0]
      : concatWavs(chunkBuffers, DEFAULTS.chunkJoinPauseMs);
    buffers.push(chunkBuffer);
    metadata.push({
      index,
      text: chunk,
      attempts: totalAttempts,
      durationSec: lastAnalysis?.durationSec ?? 0,
      metrics: lastAnalysis?.metrics ?? {},
    });
  }

  const basePause = clampNumber(options.chunkJoinPauseMs, DEFAULTS.chunkJoinPauseMs);
  const pauses = computeChunkPauses(chunks, basePause);
  const fades = computeChunkFades(chunks);
  const finalBuffer = buffers.length === 1
    ? buffers[0]
    : concatWavs(buffers, pauses, fades);

  return { audioBuffer: finalBuffer, chunks: metadata };
}
