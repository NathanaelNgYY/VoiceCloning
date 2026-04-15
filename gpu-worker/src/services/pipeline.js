import fs from 'fs';
import path from 'path';
import {
  GPT_SOVITS_ROOT,
  SCRIPTS,
  PRETRAINED,
  CONFIG_TEMPLATES,
  LOCAL_TEMP_ROOT,
} from '../config.js';
import { processManager } from './processManager.js';
import { sseManager } from './sseManager.js';
import { trainingState } from './trainingState.js';
import { generateSoVITSConfig, generateGPTConfig } from './configGenerator.js';
import { STEPS } from './trainingSteps.js';
import { downloadPrefix, uploadDirectory, uploadFile } from './s3Sync.js';

function sendStep(sessionId, stepIndex, status, detail) {
  trainingState.setStepStatus(stepIndex, status, detail || '');
  sseManager.send(sessionId, 'step-start', {
    step: stepIndex,
    name: STEPS[stepIndex],
    status,
    detail: detail || '',
  });
}

function completeStep(sessionId, stepIndex, code = 0) {
  trainingState.setStepStatus(stepIndex, code === 0 ? 'done' : 'error');
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

function mergePartFiles(dir, baseName, ext) {
  const partFile = path.join(dir, `${baseName}-0${ext}`);
  const outFile = path.join(dir, `${baseName}${ext}`);
  if (!fs.existsSync(partFile)) return;
  const content = fs.readFileSync(partFile, 'utf-8');
  fs.writeFileSync(outFile, content);
}

function skipStep(sessionId, stepIndex, reason) {
  sendStep(sessionId, stepIndex, 'skipped', reason);
  sseManager.send(sessionId, 'log', {
    stream: 'stdout',
    data: `Skipping "${STEPS[stepIndex]}": ${reason}\n`,
    timestamp: Date.now(),
  });
  completeStep(sessionId, stepIndex, 0);
  return 'skipped';
}

export async function runPipelineWithS3(sessionId, {
  expName,
  s3Prefix: rawAudioPrefix,
  batchSize = 2,
  sovitsEpochs = 8,
  gptEpochs = 15,
  sovitsSaveEvery = 4,
  gptSaveEvery = 5,
  asrLanguage = 'en',
  asrModel = 'large-v3',
}) {
  const localExpDir = path.join(LOCAL_TEMP_ROOT, expName);
  const dataDir = path.join(localExpDir, 'data');
  const rawDir = path.join(dataDir, 'raw');
  const slicedDir = path.join(dataDir, 'sliced');
  const denoisedDir = path.join(dataDir, 'denoised');
  const asrDir = path.join(dataDir, 'asr');
  const logsDir = path.join(GPT_SOVITS_ROOT, 'logs', expName);
  const sovitsWeightsDir = path.join(localExpDir, 'weights', 'sovits');
  const gptWeightsDir = path.join(localExpDir, 'weights', 'gpt');

  for (const dir of [rawDir, slicedDir, denoisedDir, asrDir, logsDir, sovitsWeightsDir, gptWeightsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // ── S3 Sync Down ──
  sseManager.send(sessionId, 'log', {
    stream: 'stdout',
    data: `Downloading training audio from S3: ${rawAudioPrefix}\n`,
    timestamp: Date.now(),
  });

  const downloadCount = await downloadPrefix(rawAudioPrefix, rawDir);
  sseManager.send(sessionId, 'log', {
    stream: 'stdout',
    data: `Downloaded ${downloadCount} files from S3\n`,
    timestamp: Date.now(),
  });

  if (downloadCount === 0) {
    throw new Error('No training audio files found in S3');
  }

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
        args: [rawDir, slicedDir, '-34', '4000', '300', '10', '500', '0.9', '0.25', '0', '1'],
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
        args: ['-i', denoisedDir, '-o', asrDir, '-s', asrModel, '-l', asrLanguage, '-p', 'int8'],
        sessionId,
      });
      assertDirHasFiles(asrDir, /\.list$/i, 'ASR');
    },

    // Step 3: 1-get-text.py
    async () => {
      if (fs.existsSync(path.join(logsDir, '2-name2text.txt'))) {
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
          opt_dir: logsDir,
          bert_pretrained_dir: PRETRAINED.bert,
          is_half: 'True',
          _CUDA_VISIBLE_DEVICES: '0',
          i_part: '0',
          all_parts: '1',
          version: 'v2',
        },
        sessionId,
      });
      mergePartFiles(logsDir, '2-name2text', '.txt');
    },

    // Step 4: 2-get-hubert-wav32k.py
    async () => {
      if (dirHasFiles(path.join(logsDir, '4-cnhubert'))) {
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
          opt_dir: logsDir,
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
      if (fs.existsSync(path.join(logsDir, '6-name2semantic.tsv'))) {
        return skipStep(sessionId, 5, 'semantic features already extracted');
      }
      sendStep(sessionId, 5, 'running');
      await processManager.run({
        scriptPath: SCRIPTS.getSemantic,
        args: [],
        env: {
          inp_text: getAsrListFile(),
          exp_name: expName,
          opt_dir: logsDir,
          pretrained_s2G: PRETRAINED.sovitsG,
          s2config_path: CONFIG_TEMPLATES.sovits,
          is_half: 'True',
          _CUDA_VISIBLE_DEVICES: '0',
          i_part: '0',
          all_parts: '1',
        },
        sessionId,
      });
      mergePartFiles(logsDir, '6-name2semantic', '.tsv');
    },

    // Step 6: Train SoVITS
    async () => {
      sendStep(sessionId, 6, 'running');
      const configPath = generateSoVITSConfig({
        expName,
        batchSize,
        epochs: sovitsEpochs,
        saveEveryEpoch: sovitsSaveEvery,
        weightsDir: sovitsWeightsDir,
      });
      await processManager.run({
        scriptPath: SCRIPTS.trainSoVITS,
        args: ['--config', configPath],
        sessionId,
      });
    },

    // Step 7: Train GPT
    async () => {
      sendStep(sessionId, 7, 'running');
      const configPath = generateGPTConfig({
        expName,
        batchSize,
        epochs: gptEpochs,
        saveEveryEpoch: gptSaveEvery,
        weightsDir: gptWeightsDir,
      });
      await processManager.run({
        scriptPath: SCRIPTS.trainGPT,
        args: ['--config_file', configPath],
        env: { _CUDA_VISIBLE_DEVICES: '0', hz: '25hz' },
        sessionId,
      });
    },
  ];

  try {
    trainingState.setStatus('running');

    for (let i = 0; i < steps.length; i++) {
      const result = await steps[i]();
      if (result !== 'skipped') {
        completeStep(sessionId, i, 0);
      }
    }

    // ── S3 Sync Up ──
    sseManager.send(sessionId, 'log', {
      stream: 'stdout',
      data: 'Uploading results to S3...\n',
      timestamp: Date.now(),
    });

    const s3DataPrefix = `training/datasets/${expName}/`;
    await uploadDirectory(denoisedDir, `${s3DataPrefix}denoised/`);
    await uploadDirectory(asrDir, `${s3DataPrefix}asr/`);
    await uploadDirectory(sovitsWeightsDir, `models/user-models/sovits/`);
    await uploadDirectory(gptWeightsDir, `models/user-models/gpt/`);

    sseManager.send(sessionId, 'log', {
      stream: 'stdout',
      data: 'S3 upload complete\n',
      timestamp: Date.now(),
    });

    trainingState.setStatus('complete');
    sseManager.send(sessionId, 'pipeline-complete', { success: true });
  } catch (err) {
    const errorMsg = parseError(err.message || String(err));
    trainingState.setError(errorMsg);
    sseManager.send(sessionId, 'error', { message: errorMsg, raw: String(err) });
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
