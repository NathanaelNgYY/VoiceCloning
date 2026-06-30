import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { inferenceServer } from './inferenceServer.js';
import { sseManager } from './sseManager.js';
import { inferenceState } from './inferenceState.js';
import { LOCAL_TEMP_ROOT, COMMA_PAUSE_SECONDS } from '../config.js';
import { uploadBuffer } from './s3Storage.js';
import { prepareTextForSynthesis } from './textPronunciation.js';

const TEMP_DIR = LOCAL_TEMP_ROOT;

// Track active streaming sessions for cancellation
const activeSessions = new Map(); // sessionId -> { cancelled: boolean }

const DEFAULTS = {
  maxChunkLength: 280,
  maxSentencesPerChunk: 3,
  chunkJoinPauseMs: 120,
  retryCount: 2,
};

// Mirror the Live Fast sampling settings: in real GPU tests Live Fast (top_k 5,
// temperature 0.7) pronounced hard medical words cleanly while this path's hotter
// sampling (top_k 15) destabilized on the same words. Higher top_k samples from 3×
// more candidate tokens, which is what let the model wander into "central" /
// "Tools and Tools" on short isolated chunks. Match Live Fast so Full Inference is
// at least as stable as the path the user confirmed works.
const FULL_QUALITY_PRESET = {
  top_k: 5,
  top_p: 0.85,
  temperature: 0.7,
  repetition_penalty: 1.35,
  speed_factor: 1.0,
};

const FULL_QUALITY_OPTIONS = {
  // Give the model CONTEXT like Live Fast, which feeds the whole text and pronounces
  // cleanly. Isolating a short sentence ("It consists of two centrioles,") removed
  // the surrounding prosody and was exactly where the model degenerated into "two
  // centrals" / "Tools and Tools". So group generously and break only at SENTENCE
  // ends (never at commas — those become natural cut5 pauses inside the chunk, like
  // Live Fast), capped so a re-roll never re-does an entire long document. Typical
  // short replies (incl. Live Full Queue) become a single Live-Fast-style chunk.
  maxChunkLength: 500,
  maxSentencesPerChunk: 50, // effectively length-governed; sentence cap is just a guard
  chunkJoinPauseMs: 120,
  // Voice-faithful takes per chunk (retryCount = takes - 1), early-accept as soon as
  // ASR confirms a complete read. Lowered from 6 to 3: with sampling now matching
  // Live Fast, the relaxed advisory-clip gate, and dictionary-word presence checking,
  // most chunks pass in 1-2 takes — fewer rolls keeps Live Full (and the queue) fast.
  retryCount: 3,
  allowBestEffortFallback: true,
};

// Minimum length (chars) before a pause-worthy boundary is honoured. Prevents a
// short lead-in clause like "Typically," from being stranded as its own rushed
// 1-2 word chunk; it merges forward into the following clause instead.
const MIN_CHUNK_LENGTH = 24;

function clampNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function applyFullInferenceQualityPreset(params = {}) {
  return {
    ...FULL_QUALITY_PRESET,
    ...params,
  };
}

export function fullInferenceQualityOptions(overrides = {}) {
  return {
    ...FULL_QUALITY_OPTIONS,
    ...overrides,
  };
}

function normalizeWhitespace(text) {
  return prepareTextForSynthesis(text);
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
  const normalized = normalizeWhitespace(String(text || ''));
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

    // Break a chunk only at a SENTENCE end (never at a comma -- commas stay inside
    // the chunk and become natural cut5 pauses, like Live Fast, instead of a
    // chunk-join silence), and only once the chunk is reasonably full. This lets
    // several short sentences group into one context-rich, naturally-flowing read
    // while still breaking at clean sentence boundaries near the length cap.
    const trimmed = current.trimEnd();
    const lastChar = trimmed.slice(-1);
    const endsSentence = trimmed.endsWith('...') || trimmed.endsWith('…') || '.!?。！？'.includes(lastChar);
    const fullEnough = trimmed.length >= Math.floor(maxChunkLength * 0.6);
    if (trimmed && endsSentence && fullEnough) {
      chunks.push(trimmed);
      current = '';
      sentenceCount = 0;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return mergeShortChunks(chunks, MIN_CHUNK_LENGTH);
}

// GPT-SoVITS frequently renders a very short fragment (a lone "Yes." or a
// stranded lead-in clause) as a near-silent buffer — its AR decoder predicts an
// early end-of-sequence. Long passages spawn more such fragments, so the odds
// that one of them defeats every retry (and aborts the whole job) climb with
// length. Fold any sub-minLength fragment into a neighbour so no chunk is ever
// short enough to trigger that failure mode.
function endsSentence(text) {
  const trimmed = String(text || '').trimEnd();
  if (trimmed.endsWith('...') || trimmed.endsWith('…')) return true;
  return '.!?。！？'.includes(trimmed.slice(-1));
}

function mergeShortChunks(chunks, minLength) {
  if (chunks.length <= 1) return chunks;

  // Pass 1: fold a short fragment backward into the previous chunk — but NOT when
  // that previous chunk already ends a sentence. Gluing e.g. "Structurally," onto
  // "…microtubules." makes a chunk that straddles a full stop and trails a dangling
  // lead-in, which the model reliably mangles. Such a fragment is a lead-in to what
  // FOLLOWS, so leave it standalone here and let pass 2 fold it forward.
  const merged = [];
  for (const chunk of chunks) {
    const text = chunk.trim();
    if (!text) continue;
    const prev = merged.length > 0 ? merged[merged.length - 1] : null;
    if (prev && text.length < minLength && !endsSentence(prev)) {
      merged[merged.length - 1] = `${prev} ${text}`.trim();
    } else {
      merged.push(text);
    }
  }

  // Pass 2: fold any remaining short chunk forward into its following neighbour.
  // Covers a short leading fragment ("Typically,") and a lead-in deferred from a
  // completed sentence ("Structurally,") — both belong with the clause after them.
  for (let i = 0; i < merged.length - 1;) {
    if (merged[i].length < minLength) {
      merged[i + 1] = `${merged[i]} ${merged[i + 1]}`.trim();
      merged.splice(i, 1);
    } else {
      i += 1;
    }
  }

  // Pass 3: a short *trailing* chunk has no forward neighbour left — fold it
  // backward as a last resort so no chunk is ever short enough to render silent.
  while (merged.length > 1 && merged[merged.length - 1].length < minLength) {
    merged[merged.length - 2] = `${merged[merged.length - 2]} ${merged[merged.length - 1]}`.trim();
    merged.pop();
  }
  return merged;
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
 * Measure the peak amplitude (0..1) of PCM16 chunk data. Returns 0 for silent
 * or empty buffers.
 */
function getChunkAbsPeak(data) {
  const bytesPerSample = 2;
  const sampleCount = Math.floor(data.length / bytesPerSample);
  if (sampleCount === 0) return 0;

  let absPeak = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = Math.abs(data.readInt16LE(i * bytesPerSample));
    if (sample > absPeak) absPeak = sample;
  }
  return absPeak / 32767;
}

/**
 * Compute a shared target peak from per-chunk peaks so chunks can be matched to a
 * common loudness WITHOUT inflating the overall level. Uses the median of the
 * non-silent chunk peaks, which preserves the model's natural loudness (and the
 * similarity to the reference voice) instead of forcing an absolute target.
 * A single chunk yields its own peak, so it is left untouched.
 */
export function computeSharedChunkPeak(peaks) {
  const audible = peaks.filter((peak) => peak >= 0.003).sort((a, b) => a - b);
  if (audible.length === 0) return 0;
  const mid = Math.floor(audible.length / 2);
  return audible.length % 2 === 0
    ? (audible[mid - 1] + audible[mid]) / 2
    : audible[mid];
}

/**
 * Scale PCM16 chunk data so its peak matches targetPeak. Used to even out
 * volume jumps between chunks. Skips if effectively silent, already within 2%
 * of target, or the target is not a usable level.
 */
function normalizeChunkPeak(data, targetPeak) {
  if (!(targetPeak > 0)) return;

  const currentPeak = getChunkAbsPeak(data);
  // Skip if effectively silent or already within 2% of target
  if (currentPeak < 0.003) return;
  if (Math.abs(currentPeak - targetPeak) / targetPeak < 0.02) return;

  const bytesPerSample = 2;
  const sampleCount = Math.floor(data.length / bytesPerSample);
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
 * Trim leading/trailing near-silence from a PCM16 chunk so the ONLY gap between
 * chunks is the deterministic join pause we insert ourselves.
 *
 * GPT-SoVITS appends a variable amount of trailing silence (and sometimes a
 * leading lead-in) to every chunk. Because Live Full forces a chunk boundary
 * after each punctuation mark, a passage spawns many chunks, and that model
 * silence STACKS on top of our join pause — so the same sentence pauses for very
 * different lengths run to run, which reads as "the pause is sometimes too long".
 * Stripping it makes every inter-chunk gap equal to pauseForPunctuation alone.
 *
 * A guard margin is preserved at each edge so a real speech onset/offset (a soft
 * consonant, a trailing breath) is never clipped — we only remove the dead air
 * past that margin.
 */
function trimEdgeSilence(data, parsedWav, { thresholdAbs = 0.0035, guardMs = 30 } = {}) {
  const blockAlign = parsedWav.blockAlign;
  const totalFrames = Math.floor(data.length / blockAlign);
  if (totalFrames < 256) return data; // too short to safely trim

  const threshold = Math.round(thresholdAbs * 32768);
  const guardFrames = Math.round((guardMs / 1000) * parsedWav.sampleRate);

  const frameAbsPeak = (frame) => {
    let peak = 0;
    for (let ch = 0; ch < parsedWav.numChannels; ch++) {
      const offset = frame * blockAlign + ch * 2;
      if (offset + 1 < data.length) {
        const sample = Math.abs(data.readInt16LE(offset));
        if (sample > peak) peak = sample;
      }
    }
    return peak;
  };

  let firstAudible = 0;
  while (firstAudible < totalFrames && frameAbsPeak(firstAudible) <= threshold) firstAudible += 1;
  if (firstAudible >= totalFrames) return data; // entirely silent — leave for analysis to reject

  let lastAudible = totalFrames - 1;
  while (lastAudible > firstAudible && frameAbsPeak(lastAudible) <= threshold) lastAudible -= 1;

  const startFrame = Math.max(0, firstAudible - guardFrames);
  const endFrame = Math.min(totalFrames, lastAudible + 1 + guardFrames);
  if (startFrame === 0 && endFrame === totalFrames) return data;

  return data.subarray(startFrame * blockAlign, endFrame * blockAlign);
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
  if (tail.includes('...') || tail.includes('\u2026')) return Math.round(basePauseMs * 3.6);
  // Em dash / double dash — brief dramatic pause
  if (last === '\u2014' || tail.includes('--')) return Math.round(basePauseMs * 1.2);
  // Period, question mark, exclamation
  if ('.!?\u3002\uff01\uff1f'.includes(last)) return Math.round(basePauseMs * 3.2);
  // Colon
  if (':\uff1a'.includes(last)) return Math.round(basePauseMs * 2.0);
  // Semicolon
  if (';\uff1b'.includes(last)) return Math.round(basePauseMs * 1.6);
  // Comma — should be brief, not a full pause
  if (',\uff0c'.includes(last)) return Math.round(basePauseMs * 0.4);
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

  // Match chunks to a shared, natural loudness (median of their own peaks) so we
  // even out inter-chunk jumps without boosting the overall level above what the
  // model produced — preserving similarity to the reference voice.
  const sharedPeak = isPCM16
    ? computeSharedChunkPeak(parsed.map((wav) => getChunkAbsPeak(wav.dataChunk)))
    : 0;

  const joinedChunks = [];
  parsed.forEach((wav, index) => {
    const chunk = Buffer.from(wav.dataChunk);
    if (isPCM16) {
      normalizeChunkPeak(chunk, sharedPeak);
      const fadeIn = index > 0 ? (fades[index - 1] ?? defaultFadeMs) : 0;
      const fadeOut = index < parsed.length - 1 ? (fades[index] ?? defaultFadeMs) : 0;
      if (fadeIn > 0) applyFade(chunk, first.sampleRate, first.numChannels, fadeIn, 'in');
      if (fadeOut > 0) applyFade(chunk, first.sampleRate, first.numChannels, fadeOut, 'out');
    }
    const desilenced = isPCM16 ? trimEdgeSilence(chunk, first) : chunk;
    const trimmed = isPCM16 ? trimToZeroCrossings(desilenced, first.blockAlign) : desilenced;
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
  // A natural read is ~15 characters/second. If a chunk's audio runs well under
  // the time its text should take, the model almost certainly dropped words; we
  // flag it so the chunk is re-rolled (a new seed usually produces a full read).
  // Tune REQUIRED_DURATION_FRACTION up to catch smaller drops (more retries) or
  // down to be more permissive. Assumes speed_factor near 1.0 or slower.
  const NATURAL_CHARS_PER_SEC = 15;
  const REQUIRED_DURATION_FRACTION = 0.65;
  const expectedDurationSec = Math.max(0.3, Math.min(20, expectedText.length / NATURAL_CHARS_PER_SEC));

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
  if (durationSec < expectedDurationSec * REQUIRED_DURATION_FRACTION) {
    reason = `Audio too short for its text — likely dropped words (${durationSec.toFixed(2)}s vs ~${expectedDurationSec.toFixed(1)}s expected)`;
  } else if (rms < 0.003 && absPeak < 0.003) {
    reason = 'Generated audio is effectively silent';
  } else if (zeroishRatio > 0.995) {
    reason = 'Generated audio contains almost no speech energy';
  } else if (clippedRatio > 0.2) {
    reason = 'Generated audio appears heavily clipped or corrupted';
  } else if (durationSec > 1.2 && longestQuietSec > 2.0) {
    reason = `Generated audio contains a long internal pause (${longestQuietSec.toFixed(2)}s)`;
  } else if (loopScore > 0.5) {
    // Lowered from 0.6: the dragging "aaaa" / laughing drone is a repetition loop,
    // and 0.6 let milder (but still audible) loops through. 0.5 catches them while
    // staying above the autocorrelation of normal sustained vowels.
    reason = `Audio appears to contain repetitive looping (score: ${loopScore.toFixed(2)})`;
  }

  return {
    ok: !reason,
    durationSec,
    reason,
    metrics: { rms, absPeak, zeroishRatio, clippedRatio, longestQuietSec, loopScore },
  };
}

export function buildAttemptVariants(baseParams, attemptIndex) {
  const synthesisBaseParams = baseParams;
  const speed = clampNumber(baseParams.speed_factor, 1);

  const requestedSeed = Number(baseParams.seed);
  const baseSeed = Number.isInteger(requestedSeed) && requestedSeed >= 0
    ? requestedSeed
    : Number.parseInt(crypto.randomUUID().replace(/-/g, '').slice(0, 8), 16);

  const safeRepPenalty = clampNumber(baseParams.repetition_penalty, 1.35);

  // Base comma/clause pause (GPT-SoVITS fragment_interval). Configurable via
  // COMMA_PAUSE_SECONDS; a caller-supplied value still wins. Retries nudge it up.
  const baseInterval = clampNumber(baseParams.fragment_interval, COMMA_PAUSE_SECONDS);

  const base = {
    ...synthesisBaseParams,
    aux_ref_audio_paths: baseParams.aux_ref_audio_paths || [],
    seed: baseSeed,
    // cut5 = "split on every punctuation": GPT-SoVITS breaks on each comma/clause
    // mark and inserts a deterministic fragment_interval of silence between fragments.
    // This makes comma pauses consistent instead of leaving them to the model's
    // stochastic prosody (cut0 fed the whole chunk in, so internal commas were a coin flip).
    text_split_method: baseParams.text_split_method || 'cut5',
    batch_size: 1,
    streaming_mode: false,
    split_bucket: true,
    parallel_infer: false,
    fragment_interval: baseInterval,
    repetition_penalty: safeRepPenalty,
    speed_factor: speed,
  };

  // Best-of-N strategy (voice-faithful): every take keeps the natural quality
  // parameters (temperature, top_k, top_p, cut5, repetition_penalty) — identical to
  // the Live Fast settings that pronounce correctly — and varies ONLY the seed. Each
  // take is a full, faithful read; the caller keeps generating (up to retryCount)
  // until ASR confirms a complete one, then stops (early-accept). Nothing about HOW
  // the model speaks changes between takes, so the cloned voice never drifts.

  if (attemptIndex === 0) {
    return base;
  }

  // Deterministic, well-spread seed offsets so each take explores a genuinely
  // different generation without changing any voice-shaping parameter.
  const SEED_OFFSETS = [0, 17, 31, 47, 67, 89];
  const seedOffset = attemptIndex < SEED_OFFSETS.length
    ? SEED_OFFSETS[attemptIndex]
    : SEED_OFFSETS[SEED_OFFSETS.length - 1] + attemptIndex;

  return {
    ...base,
    seed: (baseSeed + seedOffset) >>> 0,
    // Keep repetition_penalty pinned at the base (1.35), like Live Fast. Relaxing it
    // toward 1.0 to "reduce clipping" was what invited the "barrels of barrels" /
    // "darrels of darrels" repetition; Live Fast never relaxes it and never stutters.
    // Retries now vary ONLY the seed — a genuinely different read, no degeneration.
    repetition_penalty: safeRepPenalty,
    // Tiny pause nudge only; does not alter the voice.
    fragment_interval: baseInterval + 0.01 * attemptIndex,
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

function scoreAudioCandidate(analysis, verification = null) {
  const metrics = analysis?.metrics || {};
  const rms = clampNumber(metrics.rms, 0);
  const zeroishRatio = clampNumber(metrics.zeroishRatio, 1);
  const clippedRatio = clampNumber(metrics.clippedRatio, 1);
  const longestQuietSec = clampNumber(metrics.longestQuietSec, 99);
  const loopScore = clampNumber(metrics.loopScore, 1);
  const durationSec = clampNumber(analysis?.durationSec, 0);

  const absPeak = clampNumber(metrics.absPeak, 0);
  // A clear repetition loop (the dragging "aaaa" / laughing drone) is as
  // unacceptable as silence — rank it down in the deeply-negative band so a
  // best-effort fallback prefers ANY non-looping take and never ships the loop
  // unless every single take looped.
  if ((rms < 0.003 && absPeak < 0.003) || zeroishRatio > 0.995 || clippedRatio > 0.2 || loopScore > 0.5) {
    // Unacceptable audio still earns a finite, comparable score (deeply negative,
    // ordered by residual energy) so a last-resort fallback can pick the
    // least-bad take instead of discarding them all and aborting the whole job.
    return -1000 + Math.min(rms * 100, 1) + Math.min(absPeak * 100, 1) - clippedRatio;
  }

  // Word coverage (when ASR verification ran) dominates the comparison: among
  // takes with acceptable audio, the one that actually spoke the most of the
  // intended words wins, so the best-effort fallback never keeps a take that
  // dropped words when a more complete one exists. Speaker similarity is a
  // secondary tie-breaker so, between two equally complete takes, the one that
  // sounds most like the reference voice is preferred.
  const coverageBonus = verification ? clampNumber(verification.coverage, 1) * 10 : 0;
  const similarityBonus = Number.isFinite(verification?.similarity)
    ? clampNumber(verification.similarity, 0) * 4
    : 0;

  // A half-cut word PASSES coverage (Whisper fills it in from context), so coverage
  // alone can't tell a clipped take from a clean one — they tie, and noise decides
  // which ships. That's why a best-effort fallback was landing on a clipped take
  // even when a clean one was in the same batch. Penalize the explicit clipped /
  // missing word lists so the cleanest take wins decisively. Clipped is weighted
  // heaviest: it's the exact "half-said word" defect we're trying not to ship.
  const clippedCount = verification?.suspectWords?.length || 0;
  const missingCount = verification?.missingWords?.length || 0;
  const clippedWordPenalty = clippedCount * 6;
  const missingWordPenalty = missingCount * 4;

  return (
    coverageBonus
    + similarityBonus
    + durationSec
    + Math.min(rms * 20, 3)
    - clippedWordPenalty
    - missingWordPenalty
    - (zeroishRatio * 2)
    - (clippedRatio * 8)
    - Math.max(0, longestQuietSec - 1.4)
    - (loopScore * 3)
  );
}

async function synthesizeChunkWithRetry(chunkText, baseParams, options = {}) {
  const retryCount = Math.max(0, clampNumber(options.retryCount, DEFAULTS.retryCount));
  const allowBestEffortFallback = Boolean(options.allowBestEffortFallback);
  const verifyChunk = typeof options.verifyChunk === 'function' ? options.verifyChunk : null;
  let lastError = null;
  let bestCandidate = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const paddedText = `${chunkText.trim()} `;
    const params = buildAttemptVariants({ ...baseParams, text: paddedText }, attempt);
    try {
      const audioBuffer = await inferenceServer.synthesize(params, { timeoutMs: 180000 });
      const analysis = analyzeAudioQuality(audioBuffer, chunkText);

      // Only spend ASR on takes whose audio already looks usable; a silent or
      // clipped take is rejected by analysis alone and needs no transcript.
      let verification = null;
      if (verifyChunk && analysis.ok) {
        verification = await verifyChunk(audioBuffer, chunkText);
      }

      const score = scoreAudioCandidate(analysis, verification);
      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = { audioBuffer, analysis, verification, paramsUsed: params, attempts: attempt + 1, score };
      }
      if (!analysis.ok) {
        throw new Error(analysis.reason);
      }
      if (verification && !verification.ok) {
        const missing = verification.missingWords.slice(0, 6).join(', ');
        const clipped = (verification.suspectWords || []).slice(0, 6).join(', ');
        const voiceDrift = verification.similarityOk === false
          ? `voice drift (similarity ${(clampNumber(verification.similarity, 0) * 100).toFixed(0)}%)`
          : '';
        const detail = [
          missing ? `missing: ${missing}` : '',
          clipped ? `clipped: ${clipped}` : '',
          voiceDrift,
        ].filter(Boolean).join('; ');
        throw new Error(
          `Take rejected — covered ${(verification.coverage * 100).toFixed(0)}% of the text`
          + (detail ? ` (${detail})` : ''),
        );
      }
      return { audioBuffer, analysis, verification, paramsUsed: params, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
    }
  }

  if (allowBestEffortFallback && bestCandidate) {
    return {
      audioBuffer: bestCandidate.audioBuffer,
      analysis: bestCandidate.analysis,
      verification: bestCandidate.verification,
      paramsUsed: bestCandidate.paramsUsed,
      attempts: retryCount + 1,
      fallback: true,
      fallbackReason: lastError?.message || bestCandidate.analysis?.reason || 'Used best available chunk candidate',
    };
  }

  // Carry the best audio we saw on the error so the resilient wrapper can salvage
  // it as a last resort instead of aborting an entire long generation.
  const failure = lastError || new Error('Chunk synthesis failed');
  if (bestCandidate) failure.bestCandidate = bestCandidate;
  throw failure;
}

// Break a stubborn chunk into small pieces (~64 chars) at word boundaries so each
// problem word ends up in a short, low-drift fragment — the closest we can get to
// the "say the word on its own" case the model handles cleanly — without globally
// shrinking every chunk. Tiny fragments are merged so none is short enough to
// trigger GPT-SoVITS' near-silent-buffer failure.
function splitChunkFine(text, maxLen = 64) {
  const pieces = splitLongSentence(text, maxLen);
  return mergeShortChunks(pieces, MIN_CHUNK_LENGTH);
}

// Synthesize one chunk with escalating effort and — as a last resort — keep the
// best audio we produced rather than letting a single stubborn chunk sink an
// entire long generation. Order: (1) full retry suite on the whole chunk;
// (2) split the chunk in half and retry each sub-chunk harder; (3) fine-split into
// small fragments to isolate the offending word; (4) if everything still fails,
// return the least-bad candidate seen. Only a genuine inference-server error
// (no audio ever produced) propagates.
async function synthesizeChunkResilient(chunkText, baseParams, options = {}, { onSplit } = {}) {
  const escalate = { ...options, allowBestEffortFallback: false };
  let lastError = null;

  // Pass 1: full retry suite on the whole chunk.
  try {
    const result = await synthesizeChunkWithRetry(chunkText, { ...baseParams, text: chunkText }, escalate);
    return { audioBuffer: result.audioBuffer, attempts: result.attempts, analysis: result.analysis };
  } catch (err) {
    lastError = err;
  }

  // Pass 2: split the chunk in half and retry each sub-chunk harder. Only return
  // if EVERY sub-chunk passes clean — a half that passes is not allowed to stand in
  // for a half that failed (that would drop the failed half's words).
  const subChunks = splitChunkInHalf(chunkText);
  if (subChunks.length >= 2) {
    if (onSplit) onSplit(subChunks);
    try {
      const buffers = [];
      let attempts = 0;
      for (const sub of subChunks) {
        const subResult = await synthesizeChunkWithRetry(sub, { ...baseParams, text: sub }, escalate);
        buffers.push(subResult.audioBuffer);
        attempts += subResult.attempts;
      }
      const audioBuffer = concatWavs(buffers, DEFAULTS.chunkJoinPauseMs);
      return { audioBuffer, attempts, split: true };
    } catch (err) {
      lastError = err;
    }
  }

  // Pass 3: fine split into small fragments and retry each. This isolates the
  // offending word in a short, low-drift context (near the "word on its own"
  // case), which is what finally fixes a word that clips even after re-seeding.
  const fineChunks = splitChunkFine(chunkText);
  if (fineChunks.length > subChunks.length) {
    if (onSplit) onSplit(fineChunks);
    try {
      const buffers = [];
      let attempts = 0;
      for (const fine of fineChunks) {
        const fineResult = await synthesizeChunkWithRetry(fine, { ...baseParams, text: fine }, escalate);
        buffers.push(fineResult.audioBuffer);
        attempts += fineResult.attempts;
      }
      const audioBuffer = concatWavs(buffers, DEFAULTS.chunkJoinPauseMs);
      return { audioBuffer, attempts, split: true };
    } catch (err) {
      lastError = err;
    }
  }

  // Pass 4 (safety net): no clean read exists. NEVER substitute a partial span for
  // the whole chunk — that is what dropped "barrels of nine triplet microtubules"
  // when a passing first half outscored the failing full chunk. Instead, best-effort
  // EVERY span and concatenate, so the entire chunk text is always spoken even if
  // some spans stay imperfect (a mispronounced word is acceptable; a dropped one is
  // not — this is medical text). Finest granularity isolates each problem word.
  const spanChunks = fineChunks.length >= 2
    ? fineChunks
    : (subChunks.length >= 2 ? subChunks : [chunkText]);
  const buffers = [];
  let attempts = 0;
  for (const span of spanChunks) {
    const spanResult = await synthesizeChunkWithRetry(
      span,
      { ...baseParams, text: span },
      { ...options, allowBestEffortFallback: true },
    );
    buffers.push(spanResult.audioBuffer);
    attempts += spanResult.attempts;
  }
  const audioBuffer = concatWavs(buffers, DEFAULTS.chunkJoinPauseMs);
  console.warn(
    `[inference] chunk kept best-effort FULL-SPAN audio after exhausting clean retries `
    + `(${spanChunks.length} span(s)): ${lastError?.message}; text="${chunkText.slice(0, 80)}"`,
  );
  return {
    audioBuffer,
    attempts,
    split: spanChunks.length > 1,
    fallback: true,
    fallbackReason: lastError?.message || 'best-effort full-span chunk',
  };
}

export function cancelSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.cancelled = true;
    return true;
  }
  return false;
}

export function hasActiveInferenceSession(sessionId = null) {
  if (sessionId) {
    return activeSessions.has(sessionId);
  }
  return activeSessions.size > 0;
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
      const result = await synthesizeChunkResilient(
        chunkText,
        { ...params, text: chunkText },
        options,
        { onSplit: (subChunks) => sseManager.send(sessionId, 'chunk-split', { index, originalText: chunkText, subChunks }) },
      );
      const chunkBuffer = result.audioBuffer;
      const totalAttempts = result.attempts;
      if (result.fallback) {
        sseManager.send(sessionId, 'chunk-fallback', { index, reason: result.fallbackReason });
      }

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
    const finalBuffer = concatWavs(chunkBuffers, pauses, fades);

    const finalPath = path.join(sessionDir, 'final.wav');
    fs.writeFileSync(finalPath, finalBuffer);

    // Upload to S3 for persistence (non-blocking — don't fail the session on S3 error)
    const s3Key = `audio/output/${sessionId}/final.wav`;
    uploadBuffer(s3Key, finalBuffer, 'audio/wav').catch((err) => {
      console.error(`[inference] Failed to upload result to S3: ${err.message}`);
    });

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
    const result = await synthesizeChunkResilient(chunk, { ...params, text: chunk }, options);
    buffers.push(result.audioBuffer);
    metadata.push({
      index,
      text: chunk,
      attempts: result.attempts,
      durationSec: result.analysis?.durationSec ?? 0,
      metrics: result.analysis?.metrics ?? {},
      ...(result.fallback ? { fallback: true } : {}),
    });
  }

  const basePause = clampNumber(options.chunkJoinPauseMs, DEFAULTS.chunkJoinPauseMs);
  const pauses = computeChunkPauses(chunks, basePause);
  const fades = computeChunkFades(chunks);
  const finalBuffer = concatWavs(buffers, pauses, fades);

  return { audioBuffer: finalBuffer, chunks: metadata };
}
