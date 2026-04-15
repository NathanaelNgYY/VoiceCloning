import path from 'path';
import fs from 'fs';

function readEnv(key) {
  return process.env[key] || '';
}

function parseIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const GPT_SOVITS_ROOT = path.resolve(readEnv('GPT_SOVITS_ROOT'));
export const S3_BUCKET = readEnv('S3_BUCKET');
export const S3_REGION = readEnv('S3_REGION');
export const S3_PREFIX = readEnv('S3_PREFIX') || '';
export const WORKER_PORT = parseIntegerEnv(readEnv('WORKER_PORT'), 3001);
export const WORKER_HOST = readEnv('WORKER_HOST') || '0.0.0.0';

// Local temp directory for training data
export const LOCAL_TEMP_ROOT = readEnv('LOCAL_TEMP_ROOT') || path.join(GPT_SOVITS_ROOT, 'worker_temp');

// Python resolution (same logic as server)
const runtimeDir = path.join(GPT_SOVITS_ROOT, 'runtime');
const pythonCandidates = [
  path.join(runtimeDir, 'python.exe'),
  path.join(runtimeDir, 'bin', 'python'),
  process.env.PYTHON_EXEC || '',
].filter(Boolean);

export const PYTHON_EXEC = pythonCandidates.find(c => fs.existsSync(c))
  || process.env.PYTHON_EXEC
  || (process.platform === 'win32' ? 'python.exe' : 'python3');

export const SCRIPTS = {
  slice: path.join(GPT_SOVITS_ROOT, 'tools', 'slice_audio.py'),
  denoise: path.join(GPT_SOVITS_ROOT, 'tools', 'cmd-denoise.py'),
  asr: path.join(GPT_SOVITS_ROOT, 'tools', 'asr', 'fasterwhisper_asr.py'),
  transcribeSingle: path.join(GPT_SOVITS_ROOT, 'tools', 'asr', 'transcribe_single.py'),
  getText: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'prepare_datasets', '1-get-text.py'),
  getHubert: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'prepare_datasets', '2-get-hubert-wav32k.py'),
  getSemantic: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'prepare_datasets', '3-get-semantic.py'),
  trainSoVITS: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 's2_train.py'),
  trainGPT: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 's1_train.py'),
};

export const PRETRAINED = {
  sovitsG: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's2G2333k.pth'),
  sovitsD: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's2D2333k.pth'),
  gpt: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's1bert25hz-5kh-longer-epoch=12-step=369668.ckpt'),
  bert: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'chinese-roberta-wwm-ext-large'),
  hubert: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'chinese-hubert-base'),
};

export const CONFIG_TEMPLATES = {
  sovits: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'configs', 's2.json'),
  gpt: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'configs', 's1longer-v2.yaml'),
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
  console.warn(`[gpu-worker] GPT_SOVITS_ROOT not found: ${GPT_SOVITS_ROOT}`);
}
if (!S3_BUCKET || !S3_REGION) {
  console.warn('[gpu-worker] S3_BUCKET or S3_REGION not configured');
}
console.log(`[gpu-worker] GPT-SoVITS root: ${GPT_SOVITS_ROOT}`);
console.log(`[gpu-worker] Python: ${PYTHON_EXEC}`);
console.log(`[gpu-worker] S3: ${S3_BUCKET} (${S3_REGION}), prefix: "${S3_PREFIX}"`);
