import path from 'path';
import fs from 'fs';

const GPT_SOVITS_ROOT = process.env.GPT_SOVITS_ROOT || '';
const pythonPath = GPT_SOVITS_ROOT ? path.join(GPT_SOVITS_ROOT, 'runtime', 'python.exe') : '';

function getConfigError({ requirePython = false } = {}) {
  if (!GPT_SOVITS_ROOT) {
    return 'GPT_SOVITS_ROOT is not set. Configure server/.env first.';
  }
  if (!fs.existsSync(GPT_SOVITS_ROOT)) {
    return `GPT_SOVITS_ROOT path does not exist: ${GPT_SOVITS_ROOT}`;
  }
  if (requirePython && !fs.existsSync(pythonPath)) {
    return `Python executable not found at: ${pythonPath}`;
  }
  return null;
}

function assertConfig(options) {
  const error = getConfigError(options);
  if (error) {
    throw new Error(error);
  }
}

const startupError = getConfigError();
if (startupError) {
  console.warn(`[config] ${startupError}`);
} else {
  console.log(`GPT-SoVITS root: ${GPT_SOVITS_ROOT}`);
}

const PYTHON_EXEC = path.join(GPT_SOVITS_ROOT, 'runtime', 'python.exe');

const PRETRAINED = {
  sovitsG: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's2G2333k.pth'),
  sovitsD: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's2D2333k.pth'),
  gpt: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's1bert25hz-5kh-longer-epoch=12-step=369668.ckpt'),
  bert: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'chinese-roberta-wwm-ext-large'),
  hubert: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'chinese-hubert-base'),
};

const WEIGHT_DIRS = {
  sovits: path.join(GPT_SOVITS_ROOT, 'SoVITS_weights_v2'),
  gpt: path.join(GPT_SOVITS_ROOT, 'GPT_weights_v2'),
};

const CONFIG_TEMPLATES = {
  sovits: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'configs', 's2.json'),
  gpt: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'configs', 's1longer-v2.yaml'),
};

const EXP_ROOT = path.join(GPT_SOVITS_ROOT, 'logs');
const DATA_ROOT = path.join(GPT_SOVITS_ROOT, 'data');
const TEMP_DIR = path.join(GPT_SOVITS_ROOT, 'TEMP');

const TOOLS_DIR = path.join(GPT_SOVITS_ROOT, 'tools');
const SCRIPTS = {
  slice: path.join(TOOLS_DIR, 'slice_audio.py'),
  denoise: path.join(TOOLS_DIR, 'cmd-denoise.py'),
  asr: path.join(TOOLS_DIR, 'asr', 'fasterwhisper_asr.py'),
  getText: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'prepare_datasets', '1-get-text.py'),
  getHubert: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'prepare_datasets', '2-get-hubert-wav32k.py'),
  getSemantic: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'prepare_datasets', '3-get-semantic.py'),
  trainSoVITS: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 's2_train.py'),
  trainGPT: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 's1_train.py'),
  apiServer: path.join(GPT_SOVITS_ROOT, 'api_v2.py'),
};

const SERVER_PORT = 3000;
const INFERENCE_HOST = '127.0.0.1';
const INFERENCE_PORT = 9880;

export {
  GPT_SOVITS_ROOT,
  PYTHON_EXEC,
  PRETRAINED,
  WEIGHT_DIRS,
  CONFIG_TEMPLATES,
  EXP_ROOT,
  DATA_ROOT,
  TEMP_DIR,
  SCRIPTS,
  SERVER_PORT,
  INFERENCE_HOST,
  INFERENCE_PORT,
  getConfigError,
  assertConfig,
};
