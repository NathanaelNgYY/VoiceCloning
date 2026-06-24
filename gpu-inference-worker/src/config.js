import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const CONFIG_FILE = fileURLToPath(new URL('../.env', import.meta.url));

function loadOptionalEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadOptionalEnvFile(CONFIG_FILE);

function readEnv(key) { return process.env[key] || ''; }
function parseIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function parseFloatEnv(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const rawGptSovitsRoot = readEnv('GPT_SOVITS_ROOT');

export const GPT_SOVITS_ROOT = rawGptSovitsRoot ? path.resolve(rawGptSovitsRoot) : '';
export const S3_BUCKET = readEnv('S3_BUCKET');
export const S3_REGION = readEnv('S3_REGION');
export const S3_PREFIX = readEnv('S3_PREFIX') || '';
export const WORKER_PORT = parseIntegerEnv(readEnv('WORKER_PORT'), 3001);
export const WORKER_HOST = readEnv('WORKER_HOST') || '0.0.0.0';
export const INFERENCE_HOST = readEnv('INFERENCE_HOST') || '127.0.0.1';
export const INFERENCE_PORT = parseIntegerEnv(readEnv('INFERENCE_PORT'), 9880);
export const LOCAL_TEMP_ROOT = readEnv('LOCAL_TEMP_ROOT') || path.join(GPT_SOVITS_ROOT, 'worker_temp');

// Seconds of silence GPT-SoVITS inserts between text fragments (its `fragment_interval`).
// With text_split_method=cut5 (split on every punctuation), this is the audible pause
// at each comma / clause break. Bump it for longer comma pauses, lower for tighter speech.
export const COMMA_PAUSE_SECONDS = Math.max(0, parseFloatEnv(readEnv('COMMA_PAUSE_SECONDS'), 0.1));

const runtimeDir = path.join(GPT_SOVITS_ROOT, 'runtime');
const pythonCandidates = [
  process.env.PYTHON_EXEC || '',
  path.join(runtimeDir, 'bin', 'python'),
  path.join(runtimeDir, 'python.exe'),
].filter(Boolean);

export const PYTHON_EXEC = pythonCandidates.find(c => fs.existsSync(c))
  || (process.platform === 'win32' ? 'python.exe' : 'python3');

export const SCRIPTS = {
  apiServer: path.join(GPT_SOVITS_ROOT, 'api_v2.py'),
};

export function buildPythonEnv(extraEnv = {}) {
  return {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    PATH: [GPT_SOVITS_ROOT, process.env.PATH].filter(Boolean).join(path.delimiter),
    PYTHONPATH: [GPT_SOVITS_ROOT, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    ...extraEnv,
  };
}

if (!GPT_SOVITS_ROOT || !fs.existsSync(GPT_SOVITS_ROOT)) {
  console.warn(`[gpu-inference-worker] GPT_SOVITS_ROOT not found: ${GPT_SOVITS_ROOT}`);
}
if (!S3_BUCKET || !S3_REGION) {
  console.warn('[gpu-inference-worker] S3_BUCKET or S3_REGION not configured');
}
console.log(`[gpu-inference-worker] GPT-SoVITS root: ${GPT_SOVITS_ROOT}`);
console.log(`[gpu-inference-worker] Python: ${PYTHON_EXEC}`);
console.log(`[gpu-inference-worker] Inference server target: ${INFERENCE_HOST}:${INFERENCE_PORT}`);
