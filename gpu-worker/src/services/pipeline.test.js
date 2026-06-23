import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTrainingRunMetadata, cleanupLocalTrainingArtifacts } from './pipeline.js';

test('cleanupLocalTrainingArtifacts removes only current experiment scratch and logs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-cleanup-'));
  const localTempRoot = path.join(root, 'worker_temp');
  const logsRoot = path.join(root, 'logs');
  const localExpDir = path.join(localTempRoot, 'exp1');
  const logsDir = path.join(logsRoot, 'exp1');
  const modelCacheDir = path.join(localTempRoot, 'model_cache');

  fs.mkdirSync(path.join(localExpDir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(logsDir, 'logs_s1_v2'), { recursive: true });
  fs.mkdirSync(modelCacheDir, { recursive: true });
  fs.writeFileSync(path.join(localExpDir, 'data', 'clip.wav'), 'audio');
  fs.writeFileSync(path.join(logsDir, 'logs_s1_v2', 'checkpoint.ckpt'), 'checkpoint');
  fs.writeFileSync(path.join(modelCacheDir, 'cached.ckpt'), 'model');

  try {
    cleanupLocalTrainingArtifacts({ localExpDir, logsDir, localTempRoot, logsRoot });

    assert.equal(fs.existsSync(localExpDir), false);
    assert.equal(fs.existsSync(logsDir), false);
    assert.equal(fs.existsSync(modelCacheDir), true);
    assert.equal(fs.readFileSync(path.join(modelCacheDir, 'cached.ckpt'), 'utf-8'), 'model');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cleanupLocalTrainingArtifacts refuses paths outside expected training roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-cleanup-'));
  const localTempRoot = path.join(root, 'worker_temp');
  const logsRoot = path.join(root, 'logs');
  const outsideDir = path.join(root, 'outside-exp');
  const logsDir = path.join(logsRoot, 'exp1');

  fs.mkdirSync(outsideDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'keep.txt'), 'keep');

  try {
    assert.throws(
      () => cleanupLocalTrainingArtifacts({
        localExpDir: outsideDir,
        logsDir,
        localTempRoot,
        logsRoot,
      }),
      /outside allowed cleanup root/u,
    );
    assert.equal(fs.existsSync(path.join(outsideDir, 'keep.txt')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildTrainingRunMetadata records reproducible engine, training, reference, and dataset settings', () => {
  assert.deepEqual(
    buildTrainingRunMetadata({
      sessionId: 'session-1',
      expName: 'demo',
      startedAt: '2026-06-10T01:00:00.000Z',
      completedAt: '2026-06-10T01:30:00.000Z',
      config: {
        batchSize: 2,
        sovitsEpochs: 8,
        gptEpochs: 15,
        sovitsSaveEvery: 4,
        gptSaveEvery: 5,
        asrLanguage: 'en',
        asrModel: 'large-v3',
        skipDenoise: true,
      },
      selectedReferences: {
        mode: 'strict',
        primary: { path: 'training/datasets/demo/denoised/ref.wav', score: 124 },
      },
      sourceDatasetStats: {
        rawFileCount: 3,
        candidateClipCount: 12,
      },
    }),
    {
      schemaVersion: 1,
      sessionId: 'session-1',
      expName: 'demo',
      engineVersion: 'v2ProPlus',
      startedAt: '2026-06-10T01:00:00.000Z',
      completedAt: '2026-06-10T01:30:00.000Z',
      training: {
        batchSize: 2,
        sovitsEpochs: 8,
        gptEpochs: 15,
        sovitsSaveEvery: 4,
        gptSaveEvery: 5,
        asrLanguage: 'en',
        asrModel: 'large-v3',
        skipDenoise: true,
      },
      selectedReferences: {
        mode: 'strict',
        primary: { path: 'training/datasets/demo/denoised/ref.wav', score: 124 },
      },
      sourceDatasetStats: {
        rawFileCount: 3,
        candidateClipCount: 12,
      },
    },
  );
});
