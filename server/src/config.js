import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { loadOptionalEnvFile } from './utils/env.js';

const CONFIG_FILE = fileURLToPath(new URL('../.env', import.meta.url));
loadOptionalEnvFile(CONFIG_FILE);

function readEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== '') {
      return value;
    }
  }

  return '';
}

function parseIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseListEnv(value) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function parseModeEnv(value, fallback, allowedValues) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

function resolveEnvPath(value, fallback = '') {
  return value ? path.resolve(value) : fallback;
}

const NODE_ENV = readEnv('NODE_ENV') || 'development';
const SERVER_DIR = path.dirname(CONFIG_FILE);
const PROJECT_ROOT = path.resolve(SERVER_DIR, '..');

const OPENAI_API_KEY = readEnv('OPENAI_API_KEY');
const OPENAI_REALTIME_MODEL = readEnv('OPENAI_REALTIME_MODEL') || 'gpt-realtime';
const OPENAI_REALTIME_VAD = parseModeEnv(
  readEnv('OPENAI_REALTIME_VAD'),
  'semantic_vad',
  ['semantic_vad', 'server_vad'],
);
const OPENAI_REALTIME_SYSTEM_PROMPT =
  readEnv('OPENAI_REALTIME_SYSTEM_PROMPT') ||
  'You are a casual, helpful assistant. Keep replies concise and conversational.';

const STORAGE_MODE = readEnv('STORAGE_MODE') || 'local';
const INFERENCE_MODE = parseModeEnv(
  readEnv('INFERENCE_MODE'),
  STORAGE_MODE === 's3' ? 'remote' : 'local',
  ['local', 'remote'],
);

const GPT_SOVITS_ROOT = resolveEnvPath(readEnv('GPT_SOVITS_ROOT'));
const DEFAULT_RUNTIME_ROOT = path.resolve(PROJECT_ROOT, 'server_runtime');

function joinFromRoot(...segments) {
  return GPT_SOVITS_ROOT ? path.join(GPT_SOVITS_ROOT, ...segments) : '';
}

const runtimeDir = joinFromRoot('runtime');
const pythonCandidates = [
  runtimeDir ? path.join(runtimeDir, 'python.exe') : '',
  runtimeDir ? path.join(runtimeDir, 'bin', 'python') : '',
  process.env.PYTHON_EXEC || '',
].filter(Boolean);

const PYTHON_EXEC = pythonCandidates.find(candidate => fs.existsSync(candidate))
  || process.env.PYTHON_EXEC
  || (process.platform === 'win32' ? 'python.exe' : 'python3');

function isS3Mode() {
  return STORAGE_MODE === 's3';
}

function isRemoteInferenceMode() {
  return INFERENCE_MODE === 'remote';
}

function isLocalInferenceMode() {
  return INFERENCE_MODE === 'local';
}

function getBackendConfigError() {
  if (!['local', 'remote'].includes(INFERENCE_MODE)) {
    return `INFERENCE_MODE must be "local" or "remote", received "${INFERENCE_MODE}"`;
  }

  if (isRemoteInferenceMode() && !isS3Mode()) {
    return 'INFERENCE_MODE=remote requires STORAGE_MODE=s3 so the backend and GPU worker can hand off files via S3';
  }

  if (isS3Mode()) {
    if (!S3_BUCKET) {
      return 'STORAGE_MODE=s3 requires S3_BUCKET';
    }
    if (!S3_REGION) {
      return 'STORAGE_MODE=s3 requires S3_REGION';
    }
    if (!GPU_WORKER_HOST) {
      return 'STORAGE_MODE=s3 requires GPU_WORKER_HOST. Do not rely on localhost defaults for split-host deployments';
    }
  }

  return null;
}

function getLocalRuntimeConfigError({ requirePython = false } = {}) {
  if (!GPT_SOVITS_ROOT) {
    return 'GPT_SOVITS_ROOT is not configured. Set it in the environment or server/.env';
  }
  if (!fs.existsSync(GPT_SOVITS_ROOT)) {
    return `GPT_SOVITS_ROOT path does not exist: ${GPT_SOVITS_ROOT}`;
  }
  if (requirePython && !fs.existsSync(PYTHON_EXEC) && !['python', 'python3', 'python.exe'].includes(PYTHON_EXEC)) {
    return `Python executable not found at: ${PYTHON_EXEC}`;
  }
  return null;
}

function getConfigError({ requirePython = false, requireLocalRuntime = false } = {}) {
  const backendError = getBackendConfigError();
  if (backendError) {
    return backendError;
  }

  if (requireLocalRuntime || requirePython) {
    return getLocalRuntimeConfigError({ requirePython });
  }

  return null;
}

function assertConfig(options = {}) {
  const err = getConfigError(options);
  if (err) throw new Error(err);
}

const PRETRAINED = {
  sovitsG: joinFromRoot('GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's2G2333k.pth'),
  sovitsD: joinFromRoot('GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's2D2333k.pth'),
  gpt: joinFromRoot('GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's1bert25hz-5kh-longer-epoch=12-step=369668.ckpt'),
  bert: joinFromRoot('GPT_SoVITS', 'pretrained_models', 'chinese-roberta-wwm-ext-large'),
  hubert: joinFromRoot('GPT_SoVITS', 'pretrained_models', 'chinese-hubert-base'),
};

const WEIGHT_DIRS = {
  sovits: resolveEnvPath(
    readEnv('SOVITS_WEIGHTS_DIR'),
    GPT_SOVITS_ROOT ? joinFromRoot('SoVITS_weights_v2') : path.join(DEFAULT_RUNTIME_ROOT, 'weights', 'sovits'),
  ),
  gpt: resolveEnvPath(
    readEnv('GPT_WEIGHTS_DIR'),
    GPT_SOVITS_ROOT ? joinFromRoot('GPT_weights_v2') : path.join(DEFAULT_RUNTIME_ROOT, 'weights', 'gpt'),
  ),
};

const CONFIG_TEMPLATES = {
  sovits: joinFromRoot('GPT_SoVITS', 'configs', 's2.json'),
  gpt: joinFromRoot('GPT_SoVITS', 'configs', 's1longer-v2.yaml'),
};

const EXP_ROOT = resolveEnvPath(
  readEnv('VOICE_CLONING_LOG_ROOT', 'EXP_ROOT'),
  GPT_SOVITS_ROOT ? joinFromRoot('logs') : path.join(DEFAULT_RUNTIME_ROOT, 'logs'),
);
const DATA_ROOT = resolveEnvPath(
  readEnv('VOICE_CLONING_DATA_ROOT', 'DATA_ROOT'),
  GPT_SOVITS_ROOT ? joinFromRoot('data') : path.join(DEFAULT_RUNTIME_ROOT, 'data'),
);
const TEMP_DIR = resolveEnvPath(
  readEnv('VOICE_CLONING_TEMP_ROOT', 'TEMP_DIR'),
  GPT_SOVITS_ROOT ? joinFromRoot('TEMP') : path.join(DEFAULT_RUNTIME_ROOT, 'temp'),
);
const REF_AUDIO_DIR = TEMP_DIR ? path.join(TEMP_DIR, 'ref_audio') : '';

const TOOLS_DIR = joinFromRoot('tools');
const SCRIPTS = {
  slice: path.join(TOOLS_DIR, 'slice_audio.py'),
  denoise: path.join(TOOLS_DIR, 'cmd-denoise.py'),
  asr: path.join(TOOLS_DIR, 'asr', 'fasterwhisper_asr.py'),
  transcribeSingle: path.join(TOOLS_DIR, 'asr', 'transcribe_single.py'),
  getText: joinFromRoot('GPT_SoVITS', 'prepare_datasets', '1-get-text.py'),
  getHubert: joinFromRoot('GPT_SoVITS', 'prepare_datasets', '2-get-hubert-wav32k.py'),
  getSemantic: joinFromRoot('GPT_SoVITS', 'prepare_datasets', '3-get-semantic.py'),
  trainSoVITS: joinFromRoot('GPT_SoVITS', 's2_train.py'),
  trainGPT: joinFromRoot('GPT_SoVITS', 's1_train.py'),
  apiServer: joinFromRoot('api_v2.py'),
};

const SERVER_HOST = readEnv('SERVER_HOST', 'HOST') || '0.0.0.0';
const SERVER_PORT = parseIntegerEnv(readEnv('PORT', 'SERVER_PORT'), 3000);
const INFERENCE_HOST = readEnv('INFERENCE_HOST') || '127.0.0.1';
const INFERENCE_PORT = parseIntegerEnv(readEnv('INFERENCE_PORT'), 9880);
const TRUST_PROXY = parseBooleanEnv(readEnv('TRUST_PROXY'), true);
const SERVE_CLIENT_DIST = parseBooleanEnv(readEnv('SERVE_CLIENT_DIST'), NODE_ENV === 'production');
const CLIENT_DIST_DIR = resolveEnvPath(readEnv('CLIENT_DIST_DIR'), path.resolve(PROJECT_ROOT, 'client', 'dist'));
const CORS_ORIGINS = parseListEnv(readEnv('CORS_ORIGINS'));
const ALLOW_ALL_CORS = CORS_ORIGINS.includes('*');

const S3_BUCKET = readEnv('S3_BUCKET');
const S3_REGION = readEnv('S3_REGION');
const S3_PREFIX = readEnv('S3_PREFIX') || '';
const GPU_WORKER_HOST = readEnv('GPU_WORKER_HOST') || (isS3Mode() ? '' : INFERENCE_HOST);
const GPU_WORKER_PORT = parseIntegerEnv(readEnv('GPU_WORKER_PORT'), 3001);

const startupError = getConfigError({ requireLocalRuntime: isLocalInferenceMode() });
if (startupError) {
  console.warn(`[config] ${startupError}`);
} else if (GPT_SOVITS_ROOT) {
  console.log(`GPT-SoVITS root: ${GPT_SOVITS_ROOT}`);
  console.log(`Python executable: ${PYTHON_EXEC}`);
} else {
  console.log(`[config] No local GPT-SoVITS root configured on this backend (inference mode: ${INFERENCE_MODE})`);
}

console.log(`Inference mode: ${INFERENCE_MODE}`);
if (isS3Mode()) {
  console.log(`Storage mode: s3 (bucket: ${S3_BUCKET}, region: ${S3_REGION}, prefix: "${S3_PREFIX}")`);
  console.log(`GPU Worker: ${GPU_WORKER_HOST}:${GPU_WORKER_PORT}`);
} else {
  console.log('Storage mode: local');
  console.log(`Inference server: ${INFERENCE_HOST}:${INFERENCE_PORT}`);
}

function buildPythonEnv(extraEnv = {}) {
  return {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    PATH: [GPT_SOVITS_ROOT, process.env.PATH].filter(Boolean).join(path.delimiter),
    PYTHONPATH: [GPT_SOVITS_ROOT, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    ...extraEnv,
  };
}

function ensureRuntimeDirectories() {
  for (const dir of [DATA_ROOT, EXP_ROOT, TEMP_DIR, REF_AUDIO_DIR, WEIGHT_DIRS.sovits, WEIGHT_DIRS.gpt]) {
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export {
  NODE_ENV,
  PROJECT_ROOT,
  OPENAI_API_KEY,
  OPENAI_REALTIME_MODEL,
  OPENAI_REALTIME_VAD,
  OPENAI_REALTIME_SYSTEM_PROMPT,
  GPT_SOVITS_ROOT,
  PYTHON_EXEC,
  PRETRAINED,
  WEIGHT_DIRS,
  CONFIG_TEMPLATES,
  EXP_ROOT,
  DATA_ROOT,
  TEMP_DIR,
  REF_AUDIO_DIR,
  SCRIPTS,
  SERVER_HOST,
  SERVER_PORT,
  INFERENCE_MODE,
  INFERENCE_HOST,
  INFERENCE_PORT,
  TRUST_PROXY,
  SERVE_CLIENT_DIST,
  CLIENT_DIST_DIR,
  CORS_ORIGINS,
  ALLOW_ALL_CORS,
  STORAGE_MODE,
  S3_BUCKET,
  S3_REGION,
  S3_PREFIX,
  GPU_WORKER_HOST,
  GPU_WORKER_PORT,
  isS3Mode,
  isLocalInferenceMode,
  isRemoteInferenceMode,
  buildPythonEnv,
  ensureRuntimeDirectories,
  getBackendConfigError,
  getConfigError,
  assertConfig,
};
