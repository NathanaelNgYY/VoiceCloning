import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {
  PYTHON_EXEC,
  SCRIPTS,
  LOCAL_TEMP_ROOT,
  buildPythonEnv,
  TRANSCRIPTION_MODEL,
  TRANSCRIPTION_MODEL_ACCURATE,
  TRANSCRIPTION_MIN_COVERAGE,
} from '../config.js';
import {
  computeWordCoverage,
  findClippedWords,
  findRepeatedPhrases,
  countWords,
  findWordTimingEvidence,
  isTruncatedDictWord,
} from './wordCoverage.js';

const STARTUP_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 60_000;

// A missing word at least this long is a substantial content word (medical /
// technical term) whose absence is never acceptable — even one forces a re-roll,
// independent of the overall coverage fraction. Short function words ("the", "of")
// are noisy in ASR and left to the coverage percentage. Matches the scrutiny
// length used by findClippedWords so the missing-word and clipped-word gates agree.
// Set to 4 so missing short-but-meaningful content words ("very", "fast",
// "cell") force a re-roll instead of being hidden by high overall coverage.
const SUBSTANTIAL_WORD_LENGTH = 4;
const DICTIONARY_FORGIVEN_MIN_LENGTH = 7;

function readPcm16Wav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) return null;
    if (id === 'fmt ' && size >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        blockAlign: buffer.readUInt16LE(start + 12),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      data = buffer.subarray(start, end);
    }
    offset = end + (size % 2);
  }
  if (!format || !data || format.audioFormat !== 1 || format.bitsPerSample !== 16
    || format.channels < 1 || format.sampleRate < 1 || format.blockAlign < 2) return null;
  return { ...format, data };
}

export function hasSpeechEnergyInTimedSpan(audioBuffer, timing, opts = {}) {
  const wav = readPcm16Wav(audioBuffer);
  if (!wav || !timing || !(timing.end > timing.start)) return false;
  const frameCount = Math.floor(wav.data.length / wav.blockAlign);
  const startFrame = Math.max(0, Math.min(frameCount, Math.floor(timing.start * wav.sampleRate)));
  const endFrame = Math.max(startFrame + 1, Math.min(frameCount, Math.ceil(timing.end * wav.sampleRate)));
  if (endFrame <= startFrame) return false;

  const measure = (fromFrame, toFrame) => {
    let sumSquares = 0;
    let peak = 0;
    let voiced = 0;
    let count = 0;
    for (let frame = fromFrame; frame < toFrame; frame += 1) {
      for (let channel = 0; channel < wav.channels; channel += 1) {
        const byteOffset = frame * wav.blockAlign + channel * 2;
        if (byteOffset + 2 > wav.data.length) break;
        const amplitude = Math.abs(wav.data.readInt16LE(byteOffset) / 32768);
        sumSquares += amplitude * amplitude;
        peak = Math.max(peak, amplitude);
        if (amplitude >= 0.003) voiced += 1;
        count += 1;
      }
    }
    return {
      rms: count ? Math.sqrt(sumSquares / count) : 0,
      peak,
      voicedRatio: count ? voiced / count : 0,
    };
  };

  const whole = measure(0, frameCount);
  const span = measure(startFrame, endFrame);
  const minRms = Number.isFinite(opts.minRms) ? opts.minRms : Math.max(0.0025, whole.rms * 0.1);
  const minPeak = Number.isFinite(opts.minPeak) ? opts.minPeak : Math.max(0.012, whole.peak * 0.08);
  const minVoicedRatio = Number.isFinite(opts.minVoicedRatio) ? opts.minVoicedRatio : 0.03;
  return span.rms >= minRms && span.peak >= minPeak && span.voicedRatio >= minVoicedRatio;
}

/**
 * Manages a persistent faster-whisper sidecar (python/transcription_server.py).
 * The model loads once; requests are JSON lines over stdin/stdout keyed by id.
 */
class TranscriptionVerifier {
  constructor() {
    this.process = null;
    this.rl = null;
    this.startPromise = null;
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.unavailable = false; // set when startup fails; disables verification
  }

  async ensureStarted() {
    if (this.process) return true;
    if (this.unavailable) return false;
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };

      let proc;
      try {
        proc = spawn(PYTHON_EXEC, [SCRIPTS.transcriptionServer], {
          cwd: path.dirname(SCRIPTS.transcriptionServer),
          env: buildPythonEnv({ TRANSCRIPTION_MODEL, TRANSCRIPTION_MODEL_ACCURATE }),
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        console.warn(`[transcription] could not spawn sidecar: ${err.message}`);
        this.unavailable = true;
        return finish(false);
      }

      const timer = setTimeout(() => {
        console.warn('[transcription] sidecar startup timed out; verification disabled');
        this.unavailable = true;
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
        finish(false);
      }, STARTUP_TIMEOUT_MS);

      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let message;
        try {
          message = JSON.parse(trimmed);
        } catch {
          return; // ignore non-JSON noise on stdout
        }
        if (!settled) {
          if (message.ready === true) {
            this.process = proc;
            this.rl = rl;
            finish(true);
          } else if (message.ready === false) {
            console.warn(`[transcription] sidecar failed to load: ${message.error}`);
            this.unavailable = true;
            try { proc.kill('SIGKILL'); } catch { /* ignore */ }
            finish(false);
          }
          return;
        }
        this._handleResponse(message);
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) console.log('[transcription]', text);
      });

      proc.on('error', (err) => {
        console.warn(`[transcription] sidecar error: ${err.message}`);
        this.unavailable = true;
        finish(false);
      });

      proc.on('close', () => {
        this.process = null;
        this.rl = null;
        // Reject any in-flight requests so callers don't hang.
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error('Transcription sidecar exited'));
        }
        this.pending.clear();
        finish(false);
      });
    }).finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  _handleResponse(message) {
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error));
    else entry.resolve(message);
  }

  async requestSidecar(audioBuffer, payload = {}) {
    const started = await this.ensureStarted();
    if (!started || !this.process) throw new Error('Transcription sidecar unavailable');

    const id = crypto.randomUUID();
    const tempDir = path.join(LOCAL_TEMP_ROOT, 'verify');
    fs.mkdirSync(tempDir, { recursive: true });
    const filePath = path.join(tempDir, `${id}.wav`);
    fs.writeFileSync(filePath, audioBuffer);

    try {
      return await new Promise((resolve, reject) => {
        const requestTimeoutMs = payload.operation === 'phoneme_verify' ? 180_000 : REQUEST_TIMEOUT_MS;
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('Transcription timed out'));
        }, requestTimeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        this.process.stdin.write(`${JSON.stringify({ id, path: filePath, ...payload })}\n`);
      });
    } finally {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  async transcribeBuffer(audioBuffer, { tier } = {}) {
    const message = await this.requestSidecar(audioBuffer, { operation: 'transcribe', tier });
    return {
      text: String(message.text || ''),
      words: Array.isArray(message.words) ? message.words : [],
    };
  }

  async verifyPhonemeBuffer(audioBuffer, { start, end, arpabet } = {}) {
    return this.requestSidecar(audioBuffer, {
      operation: 'phoneme_verify',
      start,
      end,
      arpabet,
    });
  }

  /**
   * Transcribe a chunk and score how completely it covers the expected words.
   * Returns null when verification is unavailable (so callers treat it as "no
   * opinion" rather than a failure and never block synthesis on ASR problems).
   *
   * @returns {Promise<null | { ok: boolean, coverage: number, missingWords: string[], transcript: string }>}
   */
  async verifyChunk(audioBuffer, expectedText, {
    minCoverage = TRANSCRIPTION_MIN_COVERAGE,
    dictionaryWords = [],
    dictionaryEntries = [],
    finalWordTailCheck = false,
  } = {}) {
    let result;
    try {
      // Live Full / Queue (finalWordTailCheck) transcribe with the heavier accurate
      // model: those paths trade latency for catching cut words, and better word
      // timings/confidence are exactly what the clip/skip gates feed on.
      result = await this.transcribeBuffer(audioBuffer, { tier: finalWordTailCheck ? 'accurate' : undefined });
    } catch (err) {
      console.warn(`[transcription] verification skipped: ${err.message}`);
      return null;
    }
    const { text, words } = result;
    const minWordLength = finalWordTailCheck ? 1 : 2;
    const { coverage, missingWords, extraWords, expectedCount, matchedCount } = computeWordCoverage(
      expectedText,
      text,
      { minWordLength },
    );
    // Live Full / Queue (finalWordTailCheck) gates on EVERY countable missing word, not
    // just ≥4-char ones — losing "cell" or "one" is as unacceptable as a long term, and
    // those paths accept the extra re-roll cost. Live Fast keeps the ≥4 threshold so
    // short ASR-noisy function words don't cause needless re-rolls in live replies.
    const substantialLength = finalWordTailCheck ? 0 : SUBSTANTIAL_WORD_LENGTH;
    // Double-read gate: only a CONSECUTIVE repeat beyond what the text itself repeats
    // ("cell one cell one") re-rolls. The old multiset-surplus gate both false-fired on
    // stray ASR duplicates elsewhere in the transcript and missed doubled number words
    // ("one one"), which surplus counting excludes as uncountable. extraWords is still
    // returned for advisory best-of-N scoring.
    const repeatedPhrases = findRepeatedPhrases(expectedText, text);
    // skippedWords = words whose audio span is too short for their length: a genuine
    // skip (near-zero audio) OR a half-cut word (said partway then stopped). Both are
    // reliable, duration-based, and force a re-roll. suspectWords additionally
    // includes low-confidence words, which are ADVISORY only (best-of-N scoring) — a
    // confident-but-quiet real word ("daughter") must not trigger a re-roll.
    const { suspectWords, skippedWords } = findClippedWords(expectedText, words, {
      finalWordTailCheck,
      minWordLength,
    });

    // Gate on the ABSOLUTE count of substantial content words so a long chunk is as
    // strict per-word as a short one.
    let substantialMissing = missingWords.filter((w) => w.length >= substantialLength);

    // Dictionary (admin ARPAbet) words are rare medical terms Whisper-medium often
    // mis-transcribes even when the model said them correctly ("centriole"→"central"),
    // which used to force endless wasted re-rolls. For these words we trust the
    // ARPAbet and verify PRESENCE, not spelling: a mispronunciation keeps the spoken
    // word count, a skip lowers it. So if the only substantial misses are dictionary
    // words AND the heard word count matches the expected count (nothing dropped),
    // treat them as spoken-but-mistranscribed instead of missing. A real skip lowers
    // the count → not forgiven → still re-rolled (safe for medical text).
    const normalizedDictionaryEntries = Array.from(dictionaryEntries || [])
      .map((entry) => ({
        word: String(entry?.word || '').trim().toLowerCase(),
        arpabet: String(entry?.arpabet || '').trim().toUpperCase(),
      }))
      .filter((entry) => entry.word);
    const dictionaryEntryByWord = new Map(normalizedDictionaryEntries.map((entry) => [entry.word, entry]));
    const dictSet = new Set([
      ...dictionaryWords.map((w) => String(w || '').toLowerCase()),
      ...normalizedDictionaryEntries.map((entry) => entry.word),
    ].filter((w) => w.length >= DICTIONARY_FORGIVEN_MIN_LENGTH));
    let forgivenDict = [];
    const phonemeAssessments = [];
    let adjustedCoverage = coverage;
    // A hard dictionary word may be spoken correctly while Whisper spells it as a
    // different token (for example "Michaelis"). Full may forgive that spelling
    // mismatch only when anchored word timing confirms a real token occupied the
    // expected slot; a shorter gap still means an omission and remains rejected.
    if (dictSet.size > 0) {
      const expectedTokens = countWords(expectedText);
      const heardTokens = countWords(text);
      // Gate 1 (count): a mispronunciation keeps the token count exactly (one word in,
      // one wrong word out); a skip LOWERS it. So forgiveness requires NO net token
      // drop — heard >= expected. The old 10% slack (>= 0.9*expected) was a hole: on an
      // ~18-word chunk it tolerated two dropped words, which let "and unregulated" be
      // dropped yet dict-forgiven and never re-rolled. A dropped word must always lose
      // this gate (safe for medical text; at worst a correct take with ASR function-word
      // merging is re-rolled, which is acceptable).
      const countConsistent = expectedTokens > 0 && heardTokens >= expectedTokens;
      // Gate 2 (per-word, non-dict): never forgive while a NON-dictionary substantial
      // word is missing. That is a real drop, not an ASR spelling slip, and the global
      // count alone could mask it (a hallucinated token refilling the budget). This
      // closes the "skipped common word + mistranscribed dict word" hole.
      const nonDictSubstantialMissing = substantialMissing.filter((w) => !dictSet.has(w.toLowerCase()));
      if (countConsistent && nonDictSubstantialMissing.length === 0) {
        // Gate 3 (per-word, timing): when Whisper word timings are available, only
        // forgive a dict word we can positively locate in the audio — one that was
        // actually skipped has no real span under it and stays un-forgiven (safe for
        // medical text). Degrade safely: with no timing data we can't add this check,
        // so Fast falls back to the count + non-dict gates. Full requires timings.
        const hasTimings = Array.isArray(words) && words.length > 0;
        // Gate 4 (Live Full / Queue only): never forgive a dict word the model CLIPPED.
        // A truncation ("chromatin" -> "chroma") reads as a mere mis-transcription to the
        // count/timing gates above — the head has real audio and the token count holds —
        // so it would be wrongly forgiven and shipped half-said. Reject any dict word whose
        // heard token is a strict prefix of it. Gated on finalWordTailCheck so only the
        // heavy-safeguard paths pay for the extra scrutiny; Live Fast is unaffected.
        const rejectTruncated = (w) => finalWordTailCheck && isTruncatedDictWord(w, text);
        const timingAndEnergyEvidence = (w) => {
          const timing = findWordTimingEvidence(expectedText, w, words, { minWordLength });
          if (!timing) return null;
          // Full must confirm actual waveform activity inside Whisper's aligned slot;
          // a hallucinated timestamp over silence is not evidence that the word spoke.
          return !finalWordTailCheck || hasSpeechEnergyInTimedSpan(audioBuffer, timing) ? timing : null;
        };
        const missingDictionaryWords = new Set(
          missingWords.filter((word) => dictSet.has(word.toLowerCase())).map((word) => word.toLowerCase()),
        );
        // Full verifies every saved technical pronunciation present in the source,
        // even when Whisper guessed the expected spelling from context. Fast keeps
        // the established missing-word-only forgiveness path and does no phone work.
        const expectedDictionaryWords = finalWordTailCheck
          ? [...new Set(
            (String(expectedText).toLowerCase().match(/[\p{L}\p{N}']+/gu) || [])
              .filter((word) => dictSet.has(word)),
          )]
          : missingWords;
        const presenceCandidates = expectedDictionaryWords.map((word) => ({
          word,
          timing: hasTimings ? timingAndEnergyEvidence(word) : null,
        })).filter(({ word, timing }) => (
          dictSet.has(word.toLowerCase())
          && !rejectTruncated(word)
          && ((!hasTimings && !finalWordTailCheck) || timing)
        ));

        if (!finalWordTailCheck) {
          forgivenDict = presenceCandidates.map(({ word }) => word);
        } else {
          // Full requires an independent phone recognizer after presence is proven.
          // A forced timestamp cannot establish that the expected phones were spoken.
          for (const { word, timing } of presenceCandidates) {
            const dictionaryEntry = dictionaryEntryByWord.get(word.toLowerCase());
            if (!dictionaryEntry?.arpabet) continue;
            try {
              const assessment = await this.verifyPhonemeBuffer(audioBuffer, {
                start: timing.start,
                end: timing.end,
                arpabet: dictionaryEntry.arpabet,
              });
              phonemeAssessments.push({ word, ...assessment });
              if (assessment.ok === true && missingDictionaryWords.has(word.toLowerCase())) {
                forgivenDict.push(word);
              }
            } catch (error) {
              console.warn(`[phoneme] verification unavailable for "${word}": ${error.message}`);
            }
          }
        }
        if (forgivenDict.length > 0) {
          const forgivenSet = new Set(forgivenDict.map((w) => w.toLowerCase()));
          substantialMissing = substantialMissing.filter((w) => !forgivenSet.has(w.toLowerCase()));
          adjustedCoverage = expectedCount > 0
            ? (matchedCount + forgivenDict.length) / expectedCount
            : 1;
        }
      }
    }

    const ok = adjustedCoverage >= minCoverage
      && skippedWords.length === 0
      && substantialMissing.length === 0
      && repeatedPhrases.length === 0
      && !phonemeAssessments.some((assessment) => assessment.ok === false && !assessment.inconclusive)
      // Low-confidence/short spans remain advisory for Live Fast. Full/Queue have
      // five candidates to choose from, so uncertainty is a hard rejection there.
      && (!finalWordTailCheck || suspectWords.length === 0);
    if (!ok) {
      console.log(
        `[transcription] chunk REJECTED coverage=${(adjustedCoverage * 100).toFixed(0)}% `
        + `missing=[${missingWords.join(', ')}] skipped/cut=[${skippedWords.join(', ')}] `
        + `clipped(advisory)=[${suspectWords.join(', ')}] substantialMissing=[${substantialMissing.join(', ')}] `
        + `doubled=[${repeatedPhrases.join(' | ')}] `
        + `${forgivenDict.length ? `dictForgiven=[${forgivenDict.join(', ')}] ` : ''}`
        + `heard="${text.slice(0, 120)}"`,
      );
    }
    return {
      ok,
      coverage: adjustedCoverage,
      missingWords,
      forgivenDictionaryWords: forgivenDict,
      phonemeAssessments,
      extraWords,
      repeatedPhrases,
      suspectWords,
      skippedWords,
      transcript: text,
      words,
    };
  }

  /** Is the ASR sidecar usable right now? */
  isAvailable() {
    return this.process !== null && !this.unavailable;
  }

  getStatus() {
    return {
      running: this.process !== null,
      unavailable: this.unavailable,
      model: TRANSCRIPTION_MODEL,
    };
  }

  /**
   * Start the sidecar ahead of the first request and report the outcome loudly,
   * so a misconfigured/missing Whisper install is obvious in the logs instead of
   * silently turning verification off.
   */
  async warmup() {
    const ok = await this.ensureStarted();
    if (ok) {
      console.log(`[transcription] verification ACTIVE (model=${TRANSCRIPTION_MODEL})`);
    } else {
      console.warn('[transcription] verification UNAVAILABLE — chunks will NOT be checked for skipped/clipped words');
    }
    return ok;
  }
}

export const transcriptionVerifier = new TranscriptionVerifier();
