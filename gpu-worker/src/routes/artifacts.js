import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { GPT_SOVITS_ROOT, LOCAL_TEMP_ROOT } from '../config.js';
import { isPathInside, isSafePathSegment } from '../utils/paths.js';

const router = Router();
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.webm', '.mp4']);

function audioContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.mp4') return 'audio/mp4';
  return 'application/octet-stream';
}

function sendAudioFile(res, filePath) {
  const stat = fs.statSync(filePath);
  res.set({
    'Content-Type': audioContentType(filePath),
    'Content-Length': stat.size,
  });
  res.sendFile(filePath);
}

function expDataDirs(expName) {
  return [
    path.join(GPT_SOVITS_ROOT, 'data', expName),
    path.join(LOCAL_TEMP_ROOT, expName, 'data'),
  ];
}

function readTranscriptMap(asrDir) {
  const transcriptMap = new Map();
  if (!fs.existsSync(asrDir)) return transcriptMap;

  const listFile = fs.readdirSync(asrDir)
    .filter((filename) => filename.toLowerCase().endsWith('.list'))
    .sort()[0];
  if (!listFile) return transcriptMap;

  const content = fs.readFileSync(path.join(asrDir, listFile), 'utf-8');
  for (const line of content.split(/\r?\n/u).filter(Boolean)) {
    const parts = line.split('|');
    if (parts.length >= 4) {
      const filename = parts[0].replace(/\\/gu, '/').split('/').pop();
      transcriptMap.set(filename, {
        transcript: parts.slice(3).join('|'),
        lang: parts[2],
      });
    }
  }
  return transcriptMap;
}

function listTrainingAudio(expName) {
  const files = new Map();

  for (const dataDir of expDataDirs(expName)) {
    const denoisedDir = path.join(dataDir, 'denoised');
    if (!fs.existsSync(denoisedDir)) continue;

    const transcriptMap = readTranscriptMap(path.join(dataDir, 'asr'));
    for (const filename of fs.readdirSync(denoisedDir).sort()) {
      const filePath = path.join(denoisedDir, filename);
      const ext = path.extname(filename).toLowerCase();
      if (!fs.statSync(filePath).isFile() || !AUDIO_EXTENSIONS.has(ext)) continue;
      if (files.has(filename)) continue;

      const transcript = transcriptMap.get(filename) || {};
      files.set(filename, {
        filename,
        key: filePath,
        path: filePath,
        transcript: transcript.transcript || '',
        lang: transcript.lang || '',
        source: 'gpu-worker',
      });
    }
  }

  return [...files.values()];
}

function findTrainingAudioFile(expName, filename) {
  if (!isSafePathSegment(expName) || !isSafePathSegment(filename)) return null;

  for (const dataDir of expDataDirs(expName)) {
    const denoisedDir = path.join(dataDir, 'denoised');
    const filePath = path.join(denoisedDir, filename);
    if (isPathInside(filePath, denoisedDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return filePath;
    }
  }
  return null;
}

router.get('/training-audio/:expName', (req, res) => {
  const { expName } = req.params;
  if (!isSafePathSegment(expName)) {
    return res.status(400).json({ error: 'Invalid experiment name' });
  }

  try {
    res.json({ expName, files: listTrainingAudio(expName) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/training-audio/file/:expName/:filename', (req, res) => {
  try {
    const filePath = findTrainingAudioFile(req.params.expName, req.params.filename);
    if (!filePath) {
      return res.status(404).json({ error: 'Training audio file not found' });
    }
    sendAudioFile(res, filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/inference/result/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  if (!/^[A-Za-z0-9-]+$/u.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' });
  }

  try {
    const filePath = path.join(LOCAL_TEMP_ROOT, 'inference', sessionId, 'final.wav');
    if (!isPathInside(filePath, path.join(LOCAL_TEMP_ROOT, 'inference')) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Result not ready or session not found' });
    }
    sendAudioFile(res, filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ref-audio', (req, res) => {
  const filePath = path.resolve(String(req.query.filePath || ''));
  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  const allowedRoots = [GPT_SOVITS_ROOT, LOCAL_TEMP_ROOT].filter(Boolean);
  const isAllowed = allowedRoots.some((root) => isPathInside(filePath, root));
  if (!isAllowed) {
    return res.status(400).json({ error: 'filePath is outside allowed audio roots' });
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.status(404).json({ error: 'Reference audio file not found' });
  }

  try {
    sendAudioFile(res, filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

