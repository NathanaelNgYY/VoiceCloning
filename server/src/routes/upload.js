import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { DATA_ROOT, REF_AUDIO_DIR, GPT_SOVITS_ROOT } from '../config.js';
import { isSafePathSegment, sanitizeFilename } from '../utils/paths.js';
import { isS3Mode, generatePresignedPutUrl, headObject } from '../services/s3Storage.js';

const router = Router();

// Training audio upload - saves to data/<exp>/raw/
const trainingStorage = multer.diskStorage({
  destination(req, _file, cb) {
    const expName = req.body.expName || req.query.expName;
    if (!expName) return cb(new Error('expName is required'));
    if (!isSafePathSegment(expName)) return cb(new Error('expName contains unsupported characters'));
    if (!DATA_ROOT) return cb(new Error('Training data directory is not configured'));
    const dir = path.join(DATA_ROOT, expName, 'raw');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    cb(null, sanitizeFilename(file.originalname, 'training-audio'));
  },
});

const uploadTraining = multer({
  storage: trainingStorage,
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.wav', '.mp3', '.ogg', '.flac', '.m4a'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  },
});

router.post('/upload', uploadTraining.array('files', 50), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  res.json({
    message: `${req.files.length} file(s) uploaded`,
    files: req.files.map(f => f.originalname),
  });
});

// Reference audio upload for inference
const refStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    if (!REF_AUDIO_DIR) {
      return cb(new Error('Reference audio directory is not configured'));
    }
    fs.mkdirSync(REF_AUDIO_DIR, { recursive: true });
    cb(null, REF_AUDIO_DIR);
  },
  filename(_req, file, cb) {
    const sanitized = sanitizeFilename(file.originalname, 'reference-audio');
    cb(null, `ref_${Date.now()}_${sanitized}`);
  },
});

const uploadRef = multer({ storage: refStorage });

router.post('/upload-ref', uploadRef.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const relativePath = GPT_SOVITS_ROOT ? path.relative(GPT_SOVITS_ROOT, req.file.path) : '';
  const pathForClient = relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(req.file.path);
  res.json({
    path: pathForClient.replace(/\\/g, '/'),
    filename: req.file.filename,
  });
});

router.post('/live/upload', uploadRef.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded' });
  }
  const relativePath = GPT_SOVITS_ROOT ? path.relative(GPT_SOVITS_ROOT, req.file.path) : '';
  const pathForClient = relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(req.file.path);
  res.json({ filePath: pathForClient.replace(/\\/g, '/') });
});

// ── S3 presigned upload endpoints ──

const ALLOWED_AUDIO_EXTS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a'];

router.post('/upload/presign', async (req, res) => {
  if (!isS3Mode()) {
    return res.status(400).json({ error: 'Presigned uploads only available in S3 mode' });
  }

  const { expName, files } = req.body;
  if (!expName) {
    return res.status(400).json({ error: 'expName is required' });
  }
  if (!isSafePathSegment(expName)) {
    return res.status(400).json({ error: 'expName contains unsupported characters' });
  }
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'files array is required' });
  }
  if (files.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 files per upload' });
  }

  try {
    const uploads = [];
    for (const file of files) {
      const ext = path.extname(file.name || '').toLowerCase();
      if (!ALLOWED_AUDIO_EXTS.includes(ext)) {
        return res.status(400).json({ error: `File "${file.name}" has unsupported extension "${ext}"` });
      }
      const safeName = sanitizeFilename(file.name, 'training-audio');
      const key = `training/datasets/${expName}/raw/${safeName}`;
      const contentType = file.type || 'audio/wav';
      const { url } = await generatePresignedPutUrl(key, contentType);
      uploads.push({ filename: safeName, url, key });
    }
    res.json({ uploads });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload/confirm', async (req, res) => {
  if (!isS3Mode()) {
    return res.status(400).json({ error: 'Only available in S3 mode' });
  }

  const { expName, keys } = req.body;
  if (!expName || !Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ error: 'expName and keys array are required' });
  }

  try {
    let confirmed = 0;
    const confirmedFiles = [];
    for (const key of keys) {
      const head = await headObject(key);
      if (head) {
        confirmed += 1;
        confirmedFiles.push(path.basename(key));
      }
    }
    res.json({ confirmed, files: confirmedFiles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload-ref/presign', async (req, res) => {
  if (!isS3Mode()) {
    return res.status(400).json({ error: 'Only available in S3 mode' });
  }

  const { filename, type } = req.body;
  if (!filename) {
    return res.status(400).json({ error: 'filename is required' });
  }

  try {
    const safeName = sanitizeFilename(filename, 'reference-audio');
    const key = `audio/reference/ref_${Date.now()}_${safeName}`;
    const contentType = type || 'audio/wav';
    const { url } = await generatePresignedPutUrl(key, contentType);
    res.json({ url, key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload-ref/confirm', async (req, res) => {
  if (!isS3Mode()) {
    return res.status(400).json({ error: 'Only available in S3 mode' });
  }

  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'key is required' });
  }

  try {
    const head = await headObject(key);
    if (!head) {
      return res.status(404).json({ error: 'File not found in S3' });
    }
    res.json({ key, filename: path.basename(key) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
