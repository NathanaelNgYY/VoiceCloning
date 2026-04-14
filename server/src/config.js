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

function resolveEnvPath(value, fallback = '') {
  return value ? path.resolve(value) : fallback;
}

const NODE_ENV = readEnv('NODE_ENV') || 'development';
const SERVER_DIR = path.dirname(CONFIG_FILE);
const PROJECT_ROOT = path.resolve(SERVER_DIR, '..');

const GPT_SOVITS_ROOT = resolveEnvPath(readEnv('GPT_SOVITS_ROOT'));

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

function getConfigError({ requirePython = false } = {}) {
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

function assertConfig(options = {}) {
  const err = getConfigError(options);
  if (err) throw new Error(err);
}

const startupError = getConfigError();
if (startupError) {
  console.warn(`[config] ${startupError}`);
} else {
  console.log(`GPT-SoVITS root: ${GPT_SOVITS_ROOT}`);
  console.log(`Python executable: ${PYTHON_EXEC}`);
}

const PRETRAINED = {
  sovitsG: joinFromRoot('GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's2G2333k.pth'),
  sovitsD: joinFromRoot('GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's2D2333k.pth'),
  gpt: joinFromRoot('GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's1bert25hz-5kh-longer-epoch=12-step=369668.ckpt'),
  bert: joinFromRoot('GPT_SoVITS', 'pretrained_models', 'chinese-roberta-wwm-ext-large'),
  hubert: joinFromRoot('GPT_SoVITS', 'pretrained_models', 'chinese-hubert-base'),
};

const WEIGHT_DIRS = {
  sovits: resolveEnvPath(readEnv('SOVITS_WEIGHTS_DIR'), joinFromRoot('SoVITS_weights_v2')),
  gpt: resolveEnvPath(readEnv('GPT_WEIGHTS_DIR'), joinFromRoot('GPT_weights_v2')),
};

const CONFIG_TEMPLATES = {
  sovits: joinFromRoot('GPT_SoVITS', 'configs', 's2.json'),
  gpt: joinFromRoot('GPT_SoVITS', 'configs', 's1longer-v2.yaml'),
};

const EXP_ROOT = resolveEnvPath(readEnv('VOICE_CLONING_LOG_ROOT', 'EXP_ROOT'), joinFromRoot('logs'));
const DATA_ROOT = resolveEnvPath(readEnv('VOICE_CLONING_DATA_ROOT', 'DATA_ROOT'), joinFromRoot('data'));
const TEMP_DIR = resolveEnvPath(readEnv('VOICE_CLONING_TEMP_ROOT', 'TEMP_DIR'), joinFromRoot('TEMP'));
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
  INFERENCE_HOST,
  INFERENCE_PORT,
  TRUST_PROXY,
  SERVE_CLIENT_DIST,
  CLIENT_DIST_DIR,
  CORS_ORIGINS,
  ALLOW_ALL_CORS,
  buildPythonEnv,
  ensureRuntimeDirectories,
  getConfigError,
  assertConfig,
};
