import path from 'path';
import fs from 'fs';

if (!process.env.GPT_SOVITS_ROOT) {
  console.error('ERROR: GPT_SOVITS_ROOT is not set.');
  console.error('Create a .env file in the server/ directory with:');
  console.error('  GPT_SOVITS_ROOT=C:\\path\\to\\your\\GPT-SoVITS-v3lora-20250228');
  console.error('See .env.example for reference.');
  process.exit(1);
}

const GPT_SOVITS_ROOT = process.env.GPT_SOVITS_ROOT;

// Validate that the GPT-SoVITS root actually exists
if (!fs.existsSync(GPT_SOVITS_ROOT)) {
  console.error(`ERROR: GPT_SOVITS_ROOT path does not exist: ${GPT_SOVITS_ROOT}`);
  console.error('Update your .env file with the correct path to your GPT-SoVITS installation.');
  process.exit(1);
}

const pythonPath = path.join(GPT_SOVITS_ROOT, 'runtime', 'python.exe');
if (!fs.existsSync(pythonPath)) {
  console.error(`ERROR: Python executable not found at: ${pythonPath}`);
  console.error('Make sure your GPT-SoVITS installation includes the runtime/ folder.');
  process.exit(1);
}

console.log(`GPT-SoVITS root: ${GPT_SOVITS_ROOT}`);

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
};
