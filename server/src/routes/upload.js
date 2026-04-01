import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { DATA_ROOT, GPT_SOVITS_ROOT } from '../config.js';

const router = Router();

// Training audio upload - saves to data/<exp>/raw/
const trainingStorage = multer.diskStorage({
  destination(req, _file, cb) {
    const expName = req.body.expName || req.query.expName;
    if (!expName) return cb(new Error('expName is required'));
    const dir = path.join(DATA_ROOT, expName, 'raw');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    cb(null, file.originalname);
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
    const dir = path.join(GPT_SOVITS_ROOT, 'TEMP', 'ref_audio');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    cb(null, `ref_${Date.now()}${path.extname(file.originalname)}`);
  },
});

const uploadRef = multer({ storage: refStorage });

router.post('/upload-ref', uploadRef.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  // Return relative path since api_v2.py runs with cwd=GPT_SOVITS_ROOT
  const relativePath = path.relative(GPT_SOVITS_ROOT, req.file.path).replace(/\\/g, '/');
  res.json({
    path: relativePath,
    filename: req.file.filename,
  });
});

export default router;
