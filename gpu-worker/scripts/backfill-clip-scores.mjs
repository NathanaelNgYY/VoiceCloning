#!/usr/bin/env node
// Backfill clip-scores.json for voices trained before quality scoring existed.
//
//   node scripts/backfill-clip-scores.mjs <exp>     # one voice
//   node scripts/backfill-clip-scores.mjs --all     # every dataset missing a cache
//
// Runs on the gpu-worker box (needs PYTHON_EXEC with librosa + S3 credentials).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

import { PYTHON_EXEC, SCRIPTS } from '../src/config.js';
import {
  downloadPrefix,
  uploadFile,
  listSubPrefixes,
  objectExists,
} from '../src/services/s3Sync.js';

const DATASETS_PREFIX = 'training/datasets/';

function runScoreClips(denoisedDir, outPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_EXEC, [SCRIPTS.scoreClips, denoisedDir, '--json', outPath], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`score_clips.py exited with code ${code}`));
    });
  });
}

async function backfillOne(expName) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `clipscores-${expName}-`));
  const outPath = path.join(tempDir, 'clip-scores.json');
  try {
    const downloaded = await downloadPrefix(`${DATASETS_PREFIX}${expName}/denoised/`, tempDir);
    if (downloaded === 0) {
      console.warn(`[skip] ${expName}: no denoised clips found`);
      return false;
    }
    await runScoreClips(tempDir, outPath);
    if (!fs.existsSync(outPath)) {
      console.warn(`[skip] ${expName}: score_clips.py produced no output`);
      return false;
    }
    await uploadFile(outPath, `${DATASETS_PREFIX}${expName}/clip-scores.json`);
    console.log(`[ok]   ${expName}: clip-scores.json uploaded`);
    return true;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/backfill-clip-scores.mjs <exp> | --all');
    process.exit(1);
  }

  let targets;
  if (arg === '--all') {
    const all = await listSubPrefixes(DATASETS_PREFIX);
    targets = [];
    for (const exp of all) {
      if (await objectExists(`${DATASETS_PREFIX}${exp}/clip-scores.json`)) {
        console.log(`[have] ${exp}: already scored, skipping`);
        continue;
      }
      targets.push(exp);
    }
  } else {
    targets = [arg];
  }

  let ok = 0;
  for (const exp of targets) {
    try {
      if (await backfillOne(exp)) ok += 1;
    } catch (err) {
      console.error(`[fail] ${exp}: ${err.message}`);
    }
  }
  console.log(`Done. Scored ${ok}/${targets.length} voice(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
