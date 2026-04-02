import crypto from 'crypto';
import { inferenceServer } from './inferenceServer.js';

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeInferenceText(text) {
  return normalizeWhitespace(text)
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[^\s\n”"')\]\}])/g, '$1 ')
    .replace(/([。！？；：，、])(?=[^\s\n”"')\]\}])/gu, '$1 ')
    .replace(/([\-–—]){2,}/g, '—')
    .replace(/([!?。，、；：])\1{1,}/gu, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function splitIntoSentences(text) {
  const normalized = normalizeInferenceText(text);
  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[.!?。！？…;；:：])\s+|\n+/u)
    .map(part => part.trim())
    .filter(Boolean);

  return sentences.length > 0 ? sentences : [normalized];
}

function cutAtPreferredBoundary(text, maxChunkLength) {
  const searchWindow = text.slice(0, maxChunkLength + 1);
  const boundaries = [
    /,\s+/g,
    /;\s+/g,
    /:\s+/g,
    /，\s*/gu,
    /；\s*/gu,
    /：\s*/gu,
    /\s+(and|but|or|because|which|that|while|when|then|so)\s+/giu,
    /\s+/g,
  ];

  let bestIndex = -1;
  for (const regex of boundaries) {
    let match;
    while ((match = regex.exec(searchWindow)) !== null) {
      const candidate = match.index + match[0].length - 1;
      if (candidate >= Math.floor(maxChunkLength * 0.5)) {
        bestIndex = Math.max(bestIndex, candidate);
      }
    }
    if (bestIndex >= Math.floor(maxChunkLength * 0.72)) break;
  }

  return bestIndex >= 0 ? bestIndex : maxChunkLength;
}

function splitLongSentence(sentence, maxChunkLength) {
  if (sentence.length <= maxChunkLength) return [sentence];

  const parts = [];
  let remaining = sentence.trim();

  while (remaining.length > maxChunkLength) {
    const cut = cutAtPreferredBoundary(remaining, maxChunkLength);
    const nextPart = remaining.slice(0, cut + (cut === maxChunkLength ? 0 : 1)).trim();
    if (nextPart) parts.push(nextPart);
    remaining = remaining.slice(cut + (cut === maxChunkLength ? 0 : 1)).trim();
  }

  if (remaining) parts.push(remaining);
  return parts.filter(Boolean);
}

export function splitTextIntoChunks(text, options = {}) {
  const maxChunkLength = Math.max(70, clampNumber(options.maxChunkLength, DEFAULTS.maxChunkLength));
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

function bytesToSampleArray(dataChunk, wav) {
  const frameCount = Math.floor(dataChunk.length / wav.blockAlign);
  const sampleCount = frameCount * wav.numChannels;

  if (wav.audioFormat === 1 && wav.bitsPerSample === 16) {
    const samples = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      samples[i] = dataChunk.readInt16LE(i * 2) / 32768;
    }
    return samples;
  }

  if (wav.audioFormat === 3 && wav.bitsPerSample === 32) {
    const samples = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      samples[i] = dataChunk.readFloatLE(i * 4);
    }
    return samples;
  }

  throw new Error(`Unsupported WAV format for smoothing: format=${wav.audioFormat}, bits=${wav.bitsPerSample}`);
}

function sampleArrayToBytes(samples, wav) {
  if (wav.audioFormat === 1 && wav.bitsPerSample === 16) {
    const output = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i += 1) {
      const value = Math.round(clamp(samples[i], -1, 1) * 32767);
      output.writeInt16LE(value, i * 2);
    }
    return output;
  }

  if (wav.audioFormat === 3 && wav.bitsPerSample === 32) {
    const output = Buffer.alloc(samples.length * 4);
    for (let i = 0; i < samples.length; i += 1) {
      output.writeFloatLE(clamp(samples[i], -1, 1), i * 4);
    }
    return output;
  }

  throw new Error(`Unsupported WAV format for smoothing: format=${wav.audioFormat}, bits=${wav.bitsPerSample}`);
}

function joinSampleArraysWithCrossfade(arrays, wav, pauseMs, crossfadeMs) {
  const channels = wav.numChannels;
  const pauseFrames = Math.max(0, Math.round((pauseMs / 1000) * wav.sampleRate));
  const crossfadeFramesTarget = Math.max(0, Math.round((crossfadeMs / 1000) * wav.sampleRate));
  const pauseSamples = pauseFrames * channels;

  let output = new Float32Array(0);

  arrays.forEach((currentArray, index) => {
    if (index === 0) {
      output = currentArray;
      return;
    }

    const prevFrames = Math.floor(output.length / channels);
    const currFrames = Math.floor(currentArray.length / channels);
    const crossfadeFrames = Math.min(crossfadeFramesTarget, prevFrames, currFrames, 4096);

    if (crossfadeFrames <= 0) {
      const combined = new Float32Array(output.length + pauseSamples + currentArray.length);
      combined.set(output, 0);
      combined.set(currentArray, output.length + pauseSamples);
      output = combined;
      return;
    }

    const crossfadeSamples = crossfadeFrames * channels;
    const keptOutputLength = output.length - crossfadeSamples;
    const tail = output.slice(keptOutputLength);
    const head = currentArray.slice(0, crossfadeSamples);
    const remainder = currentArray.slice(crossfadeSamples);
    const adjustedPauseSamples = Math.max(0, pauseSamples - crossfadeSamples);

    const combined = new Float32Array(keptOutputLength + crossfadeSamples + adjustedPauseSamples + remainder.length);
    combined.set(output.slice(0, keptOutputLength), 0);

    for (let frame = 0; frame < crossfadeFrames; frame += 1) {
      const fadeOut = (crossfadeFrames - frame) / crossfadeFrames;
      const fadeIn = (frame + 1) / crossfadeFrames;
      for (let channel = 0; channel < channels; channel += 1) {
        const idx = frame * channels + channel;
        combined[keptOutputLength + idx] = (tail[idx] * fadeOut) + (head[idx] * fadeIn);
      }
    }

    if (remainder.length > 0) {
      combined.set(remainder, keptOutputLength + crossfadeSamples + adjustedPauseSamples);
    }

    output = combined;
  });

  return output;
}

export function concatWavs(buffers, pauseMs = DEFAULTS.chunkJoinPauseMs, crossfadeMs = DEFAULTS.crossfadeMs) {
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

  try {
    const sampleArrays = parsed.map(wav => bytesToSampleArray(wav.dataChunk, wav));
    const joinedSamples = joinSampleArraysWithCrossfade(
      sampleArrays,
      first,
      clampNumber(pauseMs, DEFAULTS.chunkJoinPauseMs),
      clampNumber(crossfadeMs, DEFAULTS.crossfadeMs),
    );
    return buildWav(first.fmtChunk, sampleArrayToBytes(joinedSamples, first));
  } catch {
    const joinedChunks = [];
    const silence = createSilenceBytes(pauseMs, first);
    parsed.forEach((wav, index) => {
      joinedChunks.push(wav.dataChunk);
      if (index < parsed.length - 1 && silence.length > 0) joinedChunks.push(silence);
    });
    return buildWav(first.fmtChunk, Buffer.concat(joinedChunks));
  }
}

export function analyzeAudioQuality(buffer, expectedText = '') {
  const wav = parseWav(buffer);
  const bytes = wav.dataChunk;
  const bytesPerSample = Math.max(1, wav.bitsPerSample / 8);
  const frameCount = Math.floor(bytes.length / wav.blockAlign);
  const durationSec = frameCount / wav.sampleRate;
  const expectedMinDurationSec = Math.max(0.25, Math.min(14, expectedText.length / 42));

  let sampleCount = 0;
  let absPeak = 0;
  let rmsSum = 0;
  let zeroishCount = 0;
  let clippedCount = 0;
  let highEnergyCount = 0;

  const isQuiet = (abs) => abs < 0.0025;

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

  let reason = null;
  if (durationSec < expectedMinDurationSec * 0.42) {
    reason = `Audio duration too short for text (${durationSec.toFixed(2)}s)`;
  } else if (rms < 0.003) {
    reason = 'Generated audio is effectively silent';
  } else if (zeroishRatio > 0.995) {
    reason = 'Generated audio contains almost no speech energy';
  } else if (clippedRatio > 0.18) {
    reason = 'Generated audio appears heavily clipped or corrupted';
  } else if (durationSec > 1.2 && longestQuietSec > 0.7) {
    reason = `Generated audio contains a long internal pause (${longestQuietSec.toFixed(2)}s)`;
  }

  return {
    ok: !reason,
    durationSec,
    reason,
    metrics: { rms, absPeak, zeroishRatio, clippedRatio, longestQuietSec },
  };
}

function buildAttemptVariants(baseParams, attemptIndex) {
  const safeTemperature = clampNumber(baseParams.temperature, 1);
  const safeTopP = clampNumber(baseParams.top_p, 1);
  const safeTopK = clampNumber(baseParams.top_k, 5);
  const speed = clampNumber(baseParams.speed_factor, 1);
  const normalizedText = normalizeInferenceText(baseParams.text);

  const baseSeed = baseParams.seed ?? Number.parseInt(crypto.randomUUID().replace(/-/g, '').slice(0, 8), 16);

  const base = {
    ...baseParams,
    seed: baseSeed,
    text_split_method: baseParams.text_split_method || 'cut5',
    batch_size: 1,
    batch_threshold: 0.7,
    streaming_mode: false,
    split_bucket: true,
    parallel_infer: false,
    fragment_interval: 0.12,
    repetition_penalty: 1.08,
    speed_factor: speed,
  };

  if (attemptIndex === 0) {
    return base;
  }

  if (attemptIndex === 1) {
    return {
      ...base,
      seed: (baseSeed + 17) >>> 0,
    };
  }

  if (attemptIndex === 2) {
    return {
      ...base,
      temperature: Math.max(0.6, safeTemperature * 0.82),
      top_p: Math.min(0.92, safeTopP),
      top_k: Math.max(3, Math.min(safeTopK, 8)),
      fragment_interval: 0.22,
      repetition_penalty: 1.08,
      seed: (baseSeed + 31) >>> 0,
    };
  }

  return {
    ...base,
    temperature: 0.65,
    top_p: 0.88,
    top_k: 5,
    fragment_interval: 0.25,
    repetition_penalty: 1.1,
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

export async function synthesizeLongText(params, options = {}) {
  const cleanedText = normalizeInferenceText(params.text);
  const chunks = splitTextIntoChunks(cleanedText, options);
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

  const finalBuffer = buffers.length === 1
    ? buffers[0]
    : concatWavs(
      buffers,
      clampNumber(options.chunkJoinPauseMs, DEFAULTS.chunkJoinPauseMs),
      clampNumber(options.crossfadeMs, DEFAULTS.crossfadeMs),
    );

  return { audioBuffer: finalBuffer, chunks: metadata, normalizedText: cleanedText };
}
