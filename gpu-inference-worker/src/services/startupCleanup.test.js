import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  clearStartupModelCache,
  clearStartupRefAudioCache,
} from './startupCleanup.js';

test('clearStartupRefAudioCache removes only the ref audio cache', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inference-startup-cleanup-'));
  const localTempRoot = path.join(root, 'worker_temp');
  const refCacheDir = path.join(localTempRoot, 'ref_audio_cache');
  const modelCacheDir = path.join(localTempRoot, 'model_cache');

  fs.mkdirSync(refCacheDir, { recursive: true });
  fs.mkdirSync(modelCacheDir, { recursive: true });
  fs.writeFileSync(path.join(refCacheDir, 'cached-ref.wav'), 'ref');
  fs.writeFileSync(path.join(modelCacheDir, 'cached-model.ckpt'), 'model');

  try {
    const result = clearStartupRefAudioCache({ localTempRoot });

    assert.equal(result.cleared, true);
    assert.equal(fs.existsSync(refCacheDir), true);
    assert.deepEqual(fs.readdirSync(refCacheDir), []);
    assert.equal(fs.readFileSync(path.join(modelCacheDir, 'cached-model.ckpt'), 'utf-8'), 'model');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clearStartupRefAudioCache tolerates a missing ref audio cache directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inference-startup-cleanup-'));
  const localTempRoot = path.join(root, 'worker_temp');

  fs.mkdirSync(localTempRoot, { recursive: true });

  try {
    const result = clearStartupRefAudioCache({ localTempRoot });

    assert.equal(result.cleared, false);
    assert.equal(fs.existsSync(path.join(localTempRoot, 'ref_audio_cache')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clearStartupModelCache removes only the model cache', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inference-startup-cleanup-'));
  const localTempRoot = path.join(root, 'worker_temp');
  const refCacheDir = path.join(localTempRoot, 'ref_audio_cache');
  const modelCacheDir = path.join(localTempRoot, 'model_cache');

  fs.mkdirSync(refCacheDir, { recursive: true });
  fs.mkdirSync(modelCacheDir, { recursive: true });
  fs.writeFileSync(path.join(refCacheDir, 'cached-ref.wav'), 'ref');
  fs.writeFileSync(path.join(modelCacheDir, 'cached-model.ckpt'), 'model');

  try {
    const result = clearStartupModelCache({ localTempRoot });

    assert.equal(result.cleared, true);
    assert.equal(fs.existsSync(modelCacheDir), true);
    assert.deepEqual(fs.readdirSync(modelCacheDir), []);
    assert.equal(fs.readFileSync(path.join(refCacheDir, 'cached-ref.wav'), 'utf-8'), 'ref');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clearStartupModelCache tolerates a missing model cache directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inference-startup-cleanup-'));
  const localTempRoot = path.join(root, 'worker_temp');

  fs.mkdirSync(localTempRoot, { recursive: true });

  try {
    const result = clearStartupModelCache({ localTempRoot });

    assert.equal(result.cleared, false);
    assert.equal(fs.existsSync(path.join(localTempRoot, 'model_cache')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
