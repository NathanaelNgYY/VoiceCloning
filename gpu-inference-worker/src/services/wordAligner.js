import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { PYTHON_EXEC, buildPythonEnv } from '../config.js';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/align_words.py', import.meta.url));
const TIMEOUT_MS = 30_000;

export async function alignWords(wavPath) {
  return new Promise((resolve) => {
    let stdout = '';
    let timedOut = false;

    const proc = spawn(PYTHON_EXEC, [SCRIPT_PATH, wavPath, 'tiny'], {
      env: buildPythonEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      resolve(null);
    }, TIMEOUT_MS);

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { process.stderr.write(`[wordAligner] ${data}`); });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      if (code !== 0 || !stdout.trim()) { resolve(null); return; }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve(null);
      }
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}
