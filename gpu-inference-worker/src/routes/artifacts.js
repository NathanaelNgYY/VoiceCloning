import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { GPT_SOVITS_ROOT, LOCAL_TEMP_ROOT } from '../config.js';
import { isPathInside } from '../utils/paths.js';

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
