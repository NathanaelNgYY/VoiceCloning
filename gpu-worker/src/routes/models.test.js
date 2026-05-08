import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listWeightFiles } from './models.js';

test('listWeightFiles includes local modification metadata for frontend recency sorting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-models-'));
  const modelPath = path.join(dir, 'latestVoice-e10.ckpt');
  const modifiedAt = new Date('2026-05-08T03:14:00.000Z');

  try {
    fs.writeFileSync(modelPath, 'model');
    fs.utimesSync(modelPath, modifiedAt, modifiedAt);

    assert.deepEqual(listWeightFiles(dir, '.ckpt'), [{
      name: 'latestVoice-e10.ckpt',
      path: modelPath,
      key: modelPath,
      source: 'gpu-worker',
      size: 5,
      lastModified: modifiedAt.toISOString(),
      mtimeMs: modifiedAt.getTime(),
    }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
