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
import { computeWordCoverage, findClippedWords, findDuplicatedWords } from './wordCoverage.js';

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
  async verifyChunk(audioBuffer, expectedText, { minCoverage = TRANSCRIPTION_MIN_COVERAGE } = {}) {
    let result;
    try {
      result = await this.transcribeBuffer(audioBuffer);
    } catch (err) {
      console.warn(`[transcription] verification skipped: ${err.message}`);
      return null;
    }
    const { text, words } = result;
    const { coverage, missingWords } = computeWordCoverage(expectedText, text);
    // A word can pass coverage (Whisper fills it in) yet have been clipped — catch
    // those via per-word confidence/timing so the chunk still gets re-rolled.
    const { suspectWords } = findClippedWords(expectedText, words);
    // Coverage is order-insensitive and never penalizes a word spoken too MANY
    // times, so a "barrels of barrels" stutter passes it. Detect duplicated content
    // words so the chunk gets re-rolled instead of shipping the stutter.
    const { duplicatedWords } = findDuplicatedWords(expectedText, text);

    // Coverage is a FRACTION, so on a long chunk a single dropped or mispronounced
    // word (~3% of 30 words) clears the threshold even though it would fail a short
    // chunk. That asymmetry is why long chunks ship half-said / mispronounced words
    // while short ones don't. Gate on the ABSOLUTE count of substantial content
    // words (the at-risk medical/technical terms) so a 30-word chunk is as strict
    // per-word as a 5-word one: any substantial word missing → re-roll, regardless
    // of the overall percentage.
    const substantialMissing = missingWords.filter((w) => w.length >= SUBSTANTIAL_WORD_LENGTH);

    const ok = coverage >= minCoverage
      && suspectWords.length === 0
      && substantialMissing.length === 0
      && duplicatedWords.length === 0;
    if (!ok) {
      console.log(
        `[transcription] chunk REJECTED coverage=${(coverage * 100).toFixed(0)}% `
        + `missing=[${missingWords.join(', ')}] clipped=[${suspectWords.join(', ')}] `
        + `duplicated=[${duplicatedWords.join(', ')}] `
        + `substantialMissing=[${substantialMissing.join(', ')}] `
        + `heard="${text.slice(0, 120)}"`,
      );
    }
    return { ok, coverage, missingWords, suspectWords, duplicatedWords, transcript: text };
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
