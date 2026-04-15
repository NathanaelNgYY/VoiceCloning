import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { LOCAL_TEMP_ROOT } from '../config.js';
import { downloadFile } from '../services/s3Sync.js';

const router = Router();

const modelCache = path.join(LOCAL_TEMP_ROOT, 'model_cache');
const refAudioCache = path.join(LOCAL_TEMP_ROOT, 'ref_audio_cache');

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
