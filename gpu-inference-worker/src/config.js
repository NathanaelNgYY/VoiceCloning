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

// Milliseconds of silence the FULL-INFERENCE path splices into the finished cut0
// audio at each comma/clause break, placed via Whisper word timestamps. DISABLED by
// default (0) because timestamp-based placement is unreliable across multiple commas
// (word-index drift from hyphens/numbers/mis-transcriptions lands silences mid-word =
// glitches). Plain cut0 is smooth; commas are just quick. Set e.g. 120 to re-enable
// and experiment, but expect occasional artifacts until placement is made gap-aware.
export const COMMA_PAUSE_MS = Math.max(0, parseIntegerEnv(readEnv('COMMA_PAUSE_MS'), 0));

// ASR (Whisper) verification of synthesized chunks. GPT-SoVITS occasionally
// skips or cuts off words; transcribing each chunk and checking the intended
// words are present lets us re-roll the bad ones. Critical for medical text.
function parseBooleanEnv(value, fallback) {
  if (value === '' || value === undefined) return fallback;
  return /^(1|true|yes|on)$/iu.test(String(value).trim());
}
export const TRANSCRIPTION_VERIFY_ENABLED = parseBooleanEnv(readEnv('TRANSCRIPTION_VERIFY_ENABLED'), true);
// ASR verification of LIVE conversation clips (the /inference/tts path): each clip
// is transcribed and re-rolled once on a stutter (echoed word, false start) or
// dropped word. Costs one whisper pass (~100-300ms) per clip, hidden behind
// playback for every clip except the first — which the client marks skip_verify.
// Requires TRANSCRIPTION_VERIFY_ENABLED; set to 0/false to keep live clips unchecked.
export const LIVE_TRANSCRIPTION_VERIFY_ENABLED = parseBooleanEnv(readEnv('LIVE_TRANSCRIPTION_VERIFY_ENABLED'), true);
export const TRANSCRIPTION_MODEL = readEnv('TRANSCRIPTION_MODEL') || 'small';
// Minimum fraction of a chunk's expected words that must appear in the transcript
// for the read to be accepted. Below this, the chunk is treated as having dropped
// words and is retried.
export const TRANSCRIPTION_MIN_COVERAGE = Math.min(1, Math.max(0, parseFloatEnv(readEnv('TRANSCRIPTION_MIN_COVERAGE'), 0.85)));

// Speaker-similarity gate: score each take against the reference voice and reject
// any that drifted, so cranking the take budget for completeness can never ship a
// take that stopped sounding like the target. Degrades gracefully (skips the gate)
// if the sidecar/model is unavailable. SPEAKER_MIN_SIMILARITY is cosine 0..1; kept
// conservative by default to avoid false rejections of genuine (synthesized) takes.
export const SPEAKER_VERIFY_ENABLED = parseBooleanEnv(readEnv('SPEAKER_VERIFY_ENABLED'), true);
export const SPEAKER_MIN_SIMILARITY = Math.min(1, Math.max(0, parseFloatEnv(readEnv('SPEAKER_MIN_SIMILARITY'), 0.62)));

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
  // Shipped with the worker (not the GPT-SoVITS bundle); runs in the same venv,
  // which has faster-whisper installed.
  transcriptionServer: fileURLToPath(new URL('../python/transcription_server.py', import.meta.url)),
  speakerSimilarityServer: fileURLToPath(new URL('../python/speaker_similarity_server.py', import.meta.url)),
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
