import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { inferenceServer } from './inferenceServer.js';
import { sseManager } from './sseManager.js';
import { TEMP_DIR } from '../config.js';

// Track active streaming sessions for cancellation
const activeSessions = new Map(); // sessionId -> { cancelled: boolean }

const DEFAULTS = {
  maxChunkLength: 180,
  maxSentencesPerChunk: 2,
  chunkJoinPauseMs: 180,
  retryCount: 2,
};

function clampNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitIntoSentences(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[.!?。！？…])\s+|\n+/u)
    .map(part => part.trim())
    .filter(Boolean);

  if (sentences.length > 0) return sentences;
  return [normalized];
}

function splitLongSentence(sentence, maxChunkLength) {
  if (sentence.length <= maxChunkLength) return [sentence];

  const parts = [];
  let remaining = sentence.trim();
  const separators = [',', ';', ':', '，', '；', '：'];

  while (remaining.length > maxChunkLength) {
    let cut = -1;
    const searchWindow = remaining.slice(0, maxChunkLength + 1);
    for (const sep of separators) {
      const idx = searchWindow.lastIndexOf(sep);
      if (idx > cut) cut = idx;
    }
    if (cut < Math.floor(maxChunkLength * 0.5)) {
      cut = searchWindow.lastIndexOf(' ');
    }
    if (cut < Math.floor(maxChunkLength * 0.5)) {
      cut = maxChunkLength;
    }

    parts.push(remaining.slice(0, cut + (cut === maxChunkLength ? 0 : 1)).trim());
    remaining = remaining.slice(cut + (cut === maxChunkLength ? 0 : 1)).trim();
  }

  if (remaining) parts.push(remaining);
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

function createSilenceBytes(durationMs, parsedWav) {
  const frameCount = Math.max(0, Math.round((durationMs / 1000) * parsedWav.sampleRate));
  const byteLength = frameCount * parsedWav.blockAlign;
  return Buffer.alloc(byteLength, 0);
}

/**
 * Apply a linear fade to PCM16 audio data in-place.
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
    const gain = frame / fadeFrames;
    const appliedGain = direction === 'in' ? gain : 1 - gain;
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

// Determine pause duration (ms) based on the trailing punctuation of a chunk
function pauseForPunctuation(chunkText, basePauseMs) {
  const trimmed = chunkText.trimEnd();
  const last = trimmed[trimmed.length - 1] || '';

  if ('.!?\u3002\uff01\uff1f\u2026'.includes(last)) return Math.round(basePauseMs * 2.2);   // period, !, ?, etc.
  if (':;\uff1a\uff1b'.includes(last)) return Math.round(basePauseMs * 1.7);                  // colon, semicolon
  if (',\uff0c'.includes(last)) return Math.round(basePauseMs * 1.0);                         // comma — baseline
  return basePauseMs;                                                                          // fallback
}

// Build an array of per-gap pause durations from chunk texts
export function computeChunkPauses(chunkTexts, basePauseMs = DEFAULTS.chunkJoinPauseMs) {
  // One pause per gap (length = chunks - 1)
  return chunkTexts.slice(0, -1).map(text => pauseForPunctuation(text, basePauseMs));
}

export function concatWavs(buffers, pauseMs = DEFAULTS.chunkJoinPauseMs) {
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

  const fadeMs = 12;
  const isPCM16 = first.audioFormat === 1 && first.bitsPerSample === 16;
  const pauses = Array.isArray(pauseMs) ? pauseMs : Array(parsed.length - 1).fill(pauseMs);

  const joinedChunks = [];
  parsed.forEach((wav, index) => {
    const chunk = Buffer.from(wav.dataChunk);
    if (isPCM16) {
      if (index > 0) applyFade(chunk, first.sampleRate, first.numChannels, fadeMs, 'in');
      if (index < parsed.length - 1) applyFade(chunk, first.sampleRate, first.numChannels, fadeMs, 'out');
    }
    joinedChunks.push(chunk);
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
    seed: baseSeed,
    text_split_method: baseParams.text_split_method || 'cut5',
    batch_size: 1,
    streaming_mode: false,
    split_bucket: true,
    parallel_infer: false,
    fragment_interval: 0.18,
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
      repetition_penalty: Math.max(safeRepPenalty, 1.4),
    };
  }

  if (attemptIndex === 2) {
    return {
      ...base,
      temperature: Math.max(0.6, safeTemperature * 0.82),
      top_p: Math.min(0.92, safeTopP),
      top_k: Math.max(8, Math.min(safeTopK, 15)),
      fragment_interval: 0.22,
      repetition_penalty: Math.max(safeRepPenalty, 1.45),
      seed: (baseSeed + 31) >>> 0,
    };
  }

  return {
    ...base,
    temperature: 0.6,
    top_p: 0.88,
    top_k: 12,
    fragment_interval: 0.25,
    repetition_penalty: Math.max(safeRepPenalty, 1.5),
    seed: (baseSeed + 47) >>> 0,
    text_split_method: 'cut0',
    split_bucket: false,
  };
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

export async function synthesizeLongTextStreaming(sessionId, params, options = {}) {
  const chunks = splitTextIntoChunks(params.text, options);
  if (chunks.length === 0) {
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

      const chunkStart = Date.now();
      const result = await synthesizeChunkWithRetry(chunkText, { ...params, text: chunkText }, options);

      // Write chunk WAV to disk
      const chunkPath = path.join(sessionDir, `chunk_${String(index).padStart(3, '0')}.wav`);
      fs.writeFileSync(chunkPath, result.audioBuffer);
      chunkPaths.push(chunkPath);

      const chunkDuration = (Date.now() - chunkStart) / 1000;
      sseManager.send(sessionId, 'chunk-complete', {
        index,
        totalChunks: chunks.length,
        attempts: result.attempts,
        durationSec: parseFloat(chunkDuration.toFixed(2)),
      });
    }

    // Concatenate all chunk WAVs from disk
    const chunkBuffers = chunkPaths.map(p => fs.readFileSync(p));
    const basePause = clampNumber(options.chunkJoinPauseMs, DEFAULTS.chunkJoinPauseMs);
    const pauses = computeChunkPauses(chunks, basePause);
    const finalBuffer = chunkBuffers.length === 1
      ? chunkBuffers[0]
      : concatWavs(chunkBuffers, pauses);

    const finalPath = path.join(sessionDir, 'final.wav');
    fs.writeFileSync(finalPath, finalBuffer);

    // Clean up individual chunk files
    for (const p of chunkPaths) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }

    const totalDuration = (Date.now() - startTime) / 1000;
    sseManager.send(sessionId, 'inference-complete', {
      totalChunks: chunks.length,
      totalDurationSec: parseFloat(totalDuration.toFixed(2)),
    });
  } catch (err) {
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
    const result = await synthesizeChunkWithRetry(chunk, { ...params, text: chunk }, options);
    buffers.push(result.audioBuffer);
    metadata.push({
      index,
      text: chunk,
      attempts: result.attempts,
      durationSec: result.analysis.durationSec,
      metrics: result.analysis.metrics,
    });
  }

  const basePause = clampNumber(options.chunkJoinPauseMs, DEFAULTS.chunkJoinPauseMs);
  const pauses = computeChunkPauses(chunks, basePause);
  const finalBuffer = buffers.length === 1
    ? buffers[0]
    : concatWavs(buffers, pauses);

  return { audioBuffer: finalBuffer, chunks: metadata };
}