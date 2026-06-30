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
  TRANSCRIPTION_MIN_COVERAGE,
} from '../config.js';
import { computeWordCoverage, findClippedWords, countWords } from './wordCoverage.js';

const STARTUP_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 60_000;

// A missing word at least this long is a substantial content word (medical /
// technical term) whose absence is never acceptable — even one forces a re-roll,
// independent of the overall coverage fraction. Short function words ("the", "of")
// are noisy in ASR and left to the coverage percentage. Matches the scrutiny
// length used by findClippedWords so the missing-word and clipped-word gates agree.
const SUBSTANTIAL_WORD_LENGTH = 6;

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
          env: buildPythonEnv({ TRANSCRIPTION_MODEL }),
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
    else entry.resolve({ text: String(message.text || ''), words: Array.isArray(message.words) ? message.words : [] });
  }

  async transcribeBuffer(audioBuffer) {
    const started = await this.ensureStarted();
    if (!started || !this.process) throw new Error('Transcription sidecar unavailable');

    const id = crypto.randomUUID();
    const tempDir = path.join(LOCAL_TEMP_ROOT, 'verify');
    fs.mkdirSync(tempDir, { recursive: true });
    const filePath = path.join(tempDir, `${id}.wav`);
    fs.writeFileSync(filePath, audioBuffer);

    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('Transcription timed out'));
        }, REQUEST_TIMEOUT_MS);
        this.pending.set(id, { resolve, reject, timer });
        this.process.stdin.write(`${JSON.stringify({ id, path: filePath })}\n`);
      });
    } finally {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  /**
   * Transcribe a chunk and score how completely it covers the expected words.
   * Returns null when verification is unavailable (so callers treat it as "no
   * opinion" rather than a failure and never block synthesis on ASR problems).
   *
   * @returns {Promise<null | { ok: boolean, coverage: number, missingWords: string[], transcript: string }>}
   */
  async verifyChunk(audioBuffer, expectedText, { minCoverage = TRANSCRIPTION_MIN_COVERAGE, dictionaryWords = [] } = {}) {
    let result;
    try {
      result = await this.transcribeBuffer(audioBuffer);
    } catch (err) {
      console.warn(`[transcription] verification skipped: ${err.message}`);
      return null;
    }
    const { text, words } = result;
    const { coverage, missingWords, expectedCount, matchedCount } = computeWordCoverage(expectedText, text);
    // skippedWords = words whose audio span is too short for their length: a genuine
    // skip (near-zero audio) OR a half-cut word (said partway then stopped). Both are
    // reliable, duration-based, and force a re-roll. suspectWords additionally
    // includes low-confidence words, which are ADVISORY only (best-of-N scoring) — a
    // confident-but-quiet real word ("daughter") must not trigger a re-roll.
    const { suspectWords, skippedWords } = findClippedWords(expectedText, words);

    // Gate on the ABSOLUTE count of substantial content words so a long chunk is as
    // strict per-word as a short one.
    let substantialMissing = missingWords.filter((w) => w.length >= SUBSTANTIAL_WORD_LENGTH);

    // Dictionary (admin ARPAbet) words are rare medical terms Whisper-medium often
    // mis-transcribes even when the model said them correctly ("centriole"→"central"),
    // which used to force endless wasted re-rolls. For these words we trust the
    // ARPAbet and verify PRESENCE, not spelling: a mispronunciation keeps the spoken
    // word count, a skip lowers it. So if the only substantial misses are dictionary
    // words AND the heard word count matches the expected count (nothing dropped),
    // treat them as spoken-but-mistranscribed instead of missing. A real skip lowers
    // the count → not forgiven → still re-rolled (safe for medical text).
    const dictSet = new Set(dictionaryWords.map((w) => String(w || '').toLowerCase()).filter(Boolean));
    let forgivenDict = [];
    let adjustedCoverage = coverage;
    if (dictSet.size > 0) {
      const expectedTokens = countWords(expectedText);
      const heardTokens = countWords(text);
      const countConsistent = expectedTokens > 0 && heardTokens >= Math.floor(expectedTokens * 0.9);
      if (countConsistent) {
        forgivenDict = missingWords.filter((w) => dictSet.has(w.toLowerCase()));
        if (forgivenDict.length > 0) {
          substantialMissing = substantialMissing.filter((w) => !dictSet.has(w.toLowerCase()));
          adjustedCoverage = expectedCount > 0
            ? (matchedCount + forgivenDict.length) / expectedCount
            : 1;
        }
      }
    }

    const ok = adjustedCoverage >= minCoverage
      && skippedWords.length === 0
      && substantialMissing.length === 0;
    if (!ok) {
      console.log(
        `[transcription] chunk REJECTED coverage=${(adjustedCoverage * 100).toFixed(0)}% `
        + `missing=[${missingWords.join(', ')}] skipped/cut=[${skippedWords.join(', ')}] `
        + `clipped(advisory)=[${suspectWords.join(', ')}] substantialMissing=[${substantialMissing.join(', ')}] `
        + `${forgivenDict.length ? `dictForgiven=[${forgivenDict.join(', ')}] ` : ''}`
        + `heard="${text.slice(0, 120)}"`,
      );
    }
    return { ok, coverage: adjustedCoverage, missingWords, suspectWords, skippedWords, transcript: text };
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
