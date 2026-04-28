import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { LOCAL_TEMP_ROOT } from '../config.js';
import { GPT_SOVITS_ROOT } from '../config.js';
import { downloadFile } from '../services/s3Sync.js';

const router = Router();

const modelCache = path.join(LOCAL_TEMP_ROOT, 'model_cache');
const refAudioCache = path.join(LOCAL_TEMP_ROOT, 'ref_audio_cache');
const localGptWeightsDir = path.join(GPT_SOVITS_ROOT, 'GPT_weights_v2');
const localSoVitsWeightsDir = path.join(GPT_SOVITS_ROOT, 'SoVITS_weights_v2');

function listWeightFiles(dir, extension) {
  if (!dir || !fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir)
    .filter((filename) => filename.toLowerCase().endsWith(extension))
    .sort()
    .map((filename) => {
      const filePath = path.join(dir, filename);
      return {
        name: filename,
        path: filePath,
        key: filePath,
        source: 'gpu-worker',
      };
    });
}

router.get('/models', (_req, res) => {
  try {
    res.json({
      gpt: listWeightFiles(localGptWeightsDir, '.ckpt'),
      sovits: listWeightFiles(localSoVitsWeightsDir, '.pth'),
      root: GPT_SOVITS_ROOT,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/models/download', async (req, res) => {
  const { s3Key } = req.body;
  if (!s3Key) {
    return res.status(400).json({ error: 's3Key is required' });
  }

  const filename = path.basename(s3Key);
  const localPath = path.join(modelCache, filename);

  try {
    // Skip download if already cached
    if (!fs.existsSync(localPath)) {
      fs.mkdirSync(modelCache, { recursive: true });
      await downloadFile(s3Key, localPath);
    }
    res.json({ localPath, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ref-audio/download', async (req, res) => {
  const { s3Key } = req.body;
  if (!s3Key) {
    return res.status(400).json({ error: 's3Key is required' });
  }

  const filename = path.basename(s3Key);
  const localPath = path.join(refAudioCache, filename);

  try {
    // Skip download if already cached
    if (!fs.existsSync(localPath)) {
      fs.mkdirSync(refAudioCache, { recursive: true });
      await downloadFile(s3Key, localPath);
    }
    res.json({ localPath, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
