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
  SPEAKER_MIN_SIMILARITY,
} from '../config.js';

const STARTUP_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Manages a persistent resemblyzer sidecar (python/speaker_similarity_server.py)
 * that scores a synthesized take against the reference voice. Mirrors the
 * transcription verifier's lifecycle: model loads once, JSON lines keyed by id,
 * and any failure degrades to "no opinion" (null) rather than blocking synthesis.
 */
class SpeakerSimilarity {
  constructor() {
    this.process = null;
    this.rl = null;
    this.startPromise = null;
    this.pending = new Map();
    this.unavailable = false;
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
        proc = spawn(PYTHON_EXEC, [SCRIPTS.speakerSimilarityServer], {
          cwd: path.dirname(SCRIPTS.speakerSimilarityServer),
          env: buildPythonEnv(),
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        console.warn(`[speaker] could not spawn sidecar: ${err.message}`);
        this.unavailable = true;
        return finish(false);
      }

      const timer = setTimeout(() => {
        console.warn('[speaker] sidecar startup timed out; similarity gate disabled');
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
          return;
        }
        if (!settled) {
          if (message.ready === true) {
            this.process = proc;
            this.rl = rl;
            finish(true);
          } else if (message.ready === false) {
            console.warn(`[speaker] sidecar failed to load: ${message.error}`);
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
        if (text) console.log('[speaker]', text);
      });

      proc.on('error', (err) => {
        console.warn(`[speaker] sidecar error: ${err.message}`);
        this.unavailable = true;
        finish(false);
      });

      proc.on('close', () => {
        this.process = null;
        this.rl = null;
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error('Speaker sidecar exited'));
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
    else entry.resolve(Number(message.similarity));
  }

  async scoreBuffer(refAudioPath, takeBuffer) {
    const started = await this.ensureStarted();
    if (!started || !this.process) throw new Error('Speaker sidecar unavailable');
    if (!refAudioPath || !fs.existsSync(refAudioPath)) throw new Error('Reference audio not available');

    const id = crypto.randomUUID();
    const tempDir = path.join(LOCAL_TEMP_ROOT, 'speaker');
    fs.mkdirSync(tempDir, { recursive: true });
    const takePath = path.join(tempDir, `${id}.wav`);
    fs.writeFileSync(takePath, takeBuffer);

    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('Speaker scoring timed out'));
        }, REQUEST_TIMEOUT_MS);
        this.pending.set(id, { resolve, reject, timer });
        this.process.stdin.write(`${JSON.stringify({ id, ref: refAudioPath, take: takePath })}\n`);
      });
    } finally {
      try { fs.unlinkSync(takePath); } catch { /* ignore */ }
    }
  }

  /**
   * Score a take against the reference voice.
   * @returns {Promise<null | { ok: boolean, similarity: number }>}
   *   null when the gate is unavailable (so callers don't block on it).
   */
  async scoreChunk(refAudioPath, takeBuffer, { minSimilarity = SPEAKER_MIN_SIMILARITY } = {}) {
    let similarity;
    try {
      similarity = await this.scoreBuffer(refAudioPath, takeBuffer);
    } catch (err) {
      console.warn(`[speaker] similarity skipped: ${err.message}`);
      return null;
    }
    if (!Number.isFinite(similarity)) return null;
    return { ok: similarity >= minSimilarity, similarity };
  }

  isAvailable() {
    return this.process !== null && !this.unavailable;
  }

  getStatus() {
    return {
      running: this.process !== null,
      unavailable: this.unavailable,
      minSimilarity: SPEAKER_MIN_SIMILARITY,
    };
  }

  async warmup() {
    const ok = await this.ensureStarted();
    if (ok) {
      console.log(`[speaker] similarity gate ACTIVE (minSimilarity=${SPEAKER_MIN_SIMILARITY})`);
    } else {
      console.warn('[speaker] similarity gate UNAVAILABLE — takes will NOT be voice-checked');
    }
    return ok;
  }
}

export const speakerSimilarity = new SpeakerSimilarity();
