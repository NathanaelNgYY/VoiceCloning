import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { GPT_SOVITS_ROOT, PYTHON_EXEC, buildPythonEnv } from '../config.js';

const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = path.resolve(SERVICE_DIR, '..', 'python', 'faster_whisper_worker.py');
const MODEL_SIZE = process.env.LIVE_ASR_MODEL_SIZE || 'medium';
const PRECISION = process.env.LIVE_ASR_PRECISION || 'int8';
const BEAM_SIZE = Number.parseInt(process.env.LIVE_ASR_BEAM_SIZE || '5', 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.LIVE_ASR_TIMEOUT_MS || '120000', 10);

class LiveTranscriber {
  constructor() {
    this.proc = null;
    this.pending = new Map();
    this.stdoutBuffer = '';
  }

  ensureProcess() {
    if (this.proc && !this.proc.killed) {
      return;
    }

    this.stdoutBuffer = '';
    const args = [
      WORKER_SCRIPT,
      '--model-size',
      MODEL_SIZE,
      '--precision',
      PRECISION,
      '--beam-size',
      String(Number.isFinite(BEAM_SIZE) ? BEAM_SIZE : 5),
    ];

    this.proc = spawn(PYTHON_EXEC, args, {
      cwd: GPT_SOVITS_ROOT || process.cwd(),
      env: buildPythonEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.on('data', (chunk) => {
      this.stdoutBuffer += chunk.toString('utf8');
      const lines = this.stdoutBuffer.split(/\r?\n/u);
      this.stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        this.handleLine(line);
      }
    });

    this.proc.stderr.on('data', (chunk) => {
      console.log('[live-asr]', chunk.toString('utf8').trim());
    });

    this.proc.on('close', (code) => {
      const err = new Error(`Live ASR worker exited with code ${code}`);
      for (const request of this.pending.values()) {
        clearTimeout(request.timeout);
        request.reject(err);
      }
      this.pending.clear();
      this.proc = null;
    });

    this.proc.on('error', (err) => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timeout);
        request.reject(err);
      }
      this.pending.clear();
      this.proc = null;
    });
  }

  handleLine(line) {
    if (!line.trim()) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      console.log('[live-asr] non-json output:', line);
      return;
    }

    const request = this.pending.get(message.id);
    if (!request) return;

    clearTimeout(request.timeout);
    this.pending.delete(message.id);

    if (!message.ok) {
      request.reject(new Error(message.error || 'Live ASR failed'));
      return;
    }

    request.resolve({
      text: message.text || '',
      language: message.language || 'en',
      languageProbability: message.languageProbability,
    });
  }

  transcribe(audioPath, { language = process.env.LIVE_ASR_LANGUAGE || 'en' } = {}) {
    this.ensureProcess();

    const id = crypto.randomUUID();
    const payload = {
      id,
      audioPath,
      language,
      beamSize: Number.isFinite(BEAM_SIZE) ? BEAM_SIZE : 5,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Live ASR timed out'));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout });
      this.proc.stdin.write(`${JSON.stringify(payload)}\n`, (err) => {
        if (!err) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  stop() {
    if (!this.proc) return;
    this.proc.kill();
    this.proc = null;
  }
}

export const liveTranscriber = new LiveTranscriber();
