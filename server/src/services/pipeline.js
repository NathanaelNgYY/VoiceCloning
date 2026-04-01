import fs from 'fs';
import path from 'path';
import {
  GPT_SOVITS_ROOT,
  SCRIPTS,
  PRETRAINED,
  CONFIG_TEMPLATES,
  EXP_ROOT,
  DATA_ROOT,
  WEIGHT_DIRS,
} from '../config.js';
import { processManager } from './processManager.js';
import { sseManager } from './sseManager.js';
import { generateSoVITSConfig, generateGPTConfig } from './configGenerator.js';

const STEPS = [
  'Slice Audio',
  'Denoise',
  'ASR (Speech Recognition)',
  'Extract Text Features',
  'Extract HuBERT Features',
  'Extract Semantic Features',
  'Train SoVITS',
  'Train GPT',
];

function sendStep(sessionId, stepIndex, status, detail) {
  sseManager.send(sessionId, 'step-start', {
    step: stepIndex,
    name: STEPS[stepIndex],
    status,
    detail: detail || '',
  });
}

function completeStep(sessionId, stepIndex, code = 0) {
  sseManager.send(sessionId, 'step-complete', {
    step: stepIndex,
    name: STEPS[stepIndex],
    code,
  });
}

function dirHasFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return false;
  const files = fs.readdirSync(dir);
  return pattern ? files.some(f => pattern.test(f)) : files.length > 0;
}

function assertDirHasFiles(dir, pattern, stepName) {
  if (!dirHasFiles(dir, pattern)) {
    throw new Error(`${stepName} failed: no output files produced in ${dir}`);
  }
}

function mergePartFiles(dir, baseName, ext, hasHeader = false) {
  const partFile = path.join(dir, `${baseName}-0${ext}`);
  const outFile = path.join(dir, `${baseName}${ext}`);

  if (!fs.existsSync(partFile)) return;

  const content = fs.readFileSync(partFile, 'utf-8');
  fs.writeFileSync(outFile, content);
}

function skipStep(sessionId, stepIndex, reason) {
  sseManager.send(sessionId, 'step-start', {
    step: stepIndex,
    name: STEPS[stepIndex],
    status: 'skipped',
    detail: reason,
  });
  sseManager.send(sessionId, 'log', {
    stream: 'stdout',
    data: `Skipping "${STEPS[stepIndex]}": ${reason}\n`,
    timestamp: Date.now(),
  });
  completeStep(sessionId, stepIndex, 0);
  return 'skipped';
}

export async function runPipeline(sessionId, {
  expName,
  batchSize = 2,
  sovitsEpochs = 8,
  gptEpochs = 15,
  sovitsSaveEvery = 4,
  gptSaveEvery = 5,
  asrLanguage = 'en',
  asrModel = 'large-v3',
}) {
  const rawDir = path.join(DATA_ROOT, expName, 'raw');
  const slicedDir = path.join(DATA_ROOT, expName, 'sliced');
  const denoisedDir = path.join(DATA_ROOT, expName, 'denoised');
  const asrDir = path.join(DATA_ROOT, expName, 'asr');
  const expDir = path.join(EXP_ROOT, expName);

  // Ensure output dirs exist
  for (const dir of [slicedDir, denoisedDir, asrDir, expDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Helper to find the .list file from ASR output
  function getAsrListFile() {
    const asrFiles = fs.readdirSync(asrDir).filter(f => f.endsWith('.list'));
    return asrFiles.length > 0
      ? path.join(asrDir, asrFiles[0])
      : path.join(asrDir, 'denoised.list');
  }

  const steps = [
    // Step 0: Slice Audio
    async () => {
      if (dirHasFiles(slicedDir, /\.(wav|mp3|ogg|flac)$/i)) {
        return skipStep(sessionId, 0, 'sliced audio already exists');
      }
      sendStep(sessionId, 0, 'running');
      await processManager.run({
        scriptPath: SCRIPTS.slice,
        args: [
          rawDir, slicedDir,
          '-34', '4000', '300', '10', '500', '0.9', '0.25', '0', '1',
        ],
        sessionId,
      });
      assertDirHasFiles(slicedDir, /\.(wav|mp3|ogg|flac)$/i, 'Slice');
    },

    // Step 1: Denoise
    async () => {
      if (dirHasFiles(denoisedDir, /\.(wav|mp3|ogg|flac)$/i)) {
        return skipStep(sessionId, 1, 'denoised audio already exists');
      }
      sendStep(sessionId, 1, 'running');
      await processManager.run({
        scriptPath: SCRIPTS.denoise,
        args: ['-i', slicedDir, '-o', denoisedDir, '-p', 'float16'],
        sessionId,
      });
      assertDirHasFiles(denoisedDir, /\.(wav|mp3|ogg|flac)$/i, 'Denoise');
    },

    // Step 2: ASR
    async () => {
      if (dirHasFiles(asrDir, /\.list$/i)) {
        return skipStep(sessionId, 2, 'ASR transcript already exists');
      }
      sendStep(sessionId, 2, 'running');
      await processManager.run({
        scriptPath: SCRIPTS.asr,
        args: [
          '-i', denoisedDir,
          '-o', asrDir,
          '-s', asrModel,
          '-l', asrLanguage,
          '-p', 'int8',
        ],
        sessionId,
      });
      assertDirHasFiles(asrDir, /\.list$/i, 'ASR');
    },

    // Step 3: 1-get-text.py
    async () => {
      if (fs.existsSync(path.join(expDir, '2-name2text.txt'))) {
        return skipStep(sessionId, 3, 'text features already extracted');
      }
      sendStep(sessionId, 3, 'running');
      await processManager.run({
        scriptPath: SCRIPTS.getText,
        args: [],
        env: {
          inp_text: getAsrListFile(),
          inp_wav_dir: denoisedDir,
          exp_name: expName,
          opt_dir: path.join(expDir, ''),
          bert_pretrained_dir: PRETRAINED.bert,
          is_half: 'True',
          _CUDA_VISIBLE_DEVICES: '0',
          i_part: '0',
          all_parts: '1',
          version: 'v2',
        },
        sessionId,
      });
      mergePartFiles(expDir, '2-name2text', '.txt');
    },

    // Step 4: 2-get-hubert-wav32k.py
    async () => {
      if (dirHasFiles(path.join(expDir, '4-cnhubert'))) {
        return skipStep(sessionId, 4, 'HuBERT features already extracted');
      }
      sendStep(sessionId, 4, 'running');
      await processManager.run({
        scriptPath: SCRIPTS.getHubert,
        args: [],
        env: {
          inp_text: getAsrListFile(),
          inp_wav_dir: denoisedDir,
          exp_name: expName,
          opt_dir: path.join(expDir, ''),
          cnhubert_base_dir: PRETRAINED.hubert,
          is_half: 'True',
          _CUDA_VISIBLE_DEVICES: '0',
          i_part: '0',
          all_parts: '1',
        },
        sessionId,
      });
    },

    // Step 5: 3-get-semantic.py
    async () => {
      if (fs.existsSync(path.join(expDir, '6-name2semantic.tsv'))) {
        return skipStep(sessionId, 5, 'semantic features already extracted');
      }
      sendStep(sessionId, 5, 'running');
      await processManager.run({
        scriptPath: SCRIPTS.getSemantic,
        args: [],
        env: {
          inp_text: getAsrListFile(),
          exp_name: expName,
          opt_dir: path.join(expDir, ''),
          pretrained_s2G: PRETRAINED.sovitsG,
          s2config_path: CONFIG_TEMPLATES.sovits,
          is_half: 'True',
          _CUDA_VISIBLE_DEVICES: '0',
          i_part: '0',
          all_parts: '1',
        },
        sessionId,
      });
      mergePartFiles(expDir, '6-name2semantic', '.tsv', true);
    },

    // Step 6: Train SoVITS
    async () => {
      const pattern = new RegExp(`^${expName}_e\\d+_s\\d+\\.pth$`);
      if (dirHasFiles(WEIGHT_DIRS.sovits, pattern)) {
        return skipStep(sessionId, 6, 'SoVITS weights already exist');
      }
      sendStep(sessionId, 6, 'running');
      const configPath = generateSoVITSConfig({
        expName,
        batchSize,
        epochs: sovitsEpochs,
        saveEveryEpoch: sovitsSaveEvery,
      });
      await processManager.run({
        scriptPath: SCRIPTS.trainSoVITS,
        args: ['--config', configPath],
        sessionId,
      });
    },

    // Step 7: Train GPT
    async () => {
      const pattern = new RegExp(`^${expName}-e\\d+\\.ckpt$`);
      if (dirHasFiles(WEIGHT_DIRS.gpt, pattern)) {
        return skipStep(sessionId, 7, 'GPT weights already exist');
      }
      sendStep(sessionId, 7, 'running');
      const configPath = generateGPTConfig({
        expName,
        batchSize,
        epochs: gptEpochs,
        saveEveryEpoch: gptSaveEvery,
      });
      await processManager.run({
        scriptPath: SCRIPTS.trainGPT,
        args: ['--config_file', configPath],
        env: {
          _CUDA_VISIBLE_DEVICES: '0',
          hz: '25hz',
        },
        sessionId,
      });
    },
  ];

  try {
    for (let i = 0; i < steps.length; i++) {
      const result = await steps[i]();
      if (result !== 'skipped') {
        completeStep(sessionId, i, 0);
      }
    }
    sseManager.send(sessionId, 'pipeline-complete', { success: true });
  } catch (err) {
    const errorMsg = parseError(err.message || String(err));
    sseManager.send(sessionId, 'error', {
      message: errorMsg,
      raw: String(err),
    });
  }
}

function parseError(msg) {
  if (/CUDA out of memory|OutOfMemoryError/i.test(msg)) {
    return 'GPU out of memory. Try reducing batch size.';
  }
  if (/FileNotFoundError/i.test(msg)) {
    return 'Required file not found. Check that audio files were uploaded correctly.';
  }
  if (/exited with code/i.test(msg)) {
    return 'Step failed. Check logs for details.';
  }
  return msg;
}

export { STEPS };
