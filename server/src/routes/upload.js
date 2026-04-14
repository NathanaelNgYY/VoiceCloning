import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { DATA_ROOT, REF_AUDIO_DIR, GPT_SOVITS_ROOT } from '../config.js';
import { isSafePathSegment, sanitizeFilename } from '../utils/paths.js';

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

export default router;
