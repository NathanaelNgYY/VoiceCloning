import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { GPT_SOVITS_ROOT, LOCAL_TEMP_ROOT } from '../config.js';
import { isPathInside } from '../utils/paths.js';
import {
  getSessionChunkPath,
  getSessionChunkPreviewPath,
  getSessionChunkVersionPath,
} from '../services/longTextInference.js';
import { getObject } from '../services/s3Storage.js';

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
    // Session result and chunk files are overwritten by regeneration/restore.
    // Do not let browsers or intermediary caches reuse an older take at the same URL.
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.sendFile(filePath);
}

function sendAudioBuffer(res, buffer, contentType = 'audio/wav') {
  res.set({
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.send(buffer);
}

router.get('/inference/result/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  if (!/^[A-Za-z0-9-]+$/u.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' });
  }

  try {
    const filePath = path.join(LOCAL_TEMP_ROOT, 'inference', sessionId, 'final.wav');
    if (isPathInside(filePath, path.join(LOCAL_TEMP_ROOT, 'inference')) && fs.existsSync(filePath)) {
      return sendAudioFile(res, filePath);
    }
    return sendAudioBuffer(res, await getObject(`audio/output/${sessionId}/final.wav`));
  } catch (err) {
    const status = err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404 ? 404 : 500;
    res.status(status).json({ error: status === 404 ? 'Result not ready or session not found' : err.message });
  }
});

router.get('/inference/chunk/:sessionId/:index', async (req, res) => {
  const { sessionId, index } = req.params;
  if (!/^[A-Za-z0-9-]+$/u.test(sessionId) || !/^\d+$/u.test(index)) {
    return res.status(400).json({ error: 'Invalid chunk request' });
  }

  try {
    const filePath = getSessionChunkPath(sessionId, Number(index));
    if (isPathInside(filePath, path.join(LOCAL_TEMP_ROOT, 'inference')) && fs.existsSync(filePath)) {
      return sendAudioFile(res, filePath);
    }
    return sendAudioBuffer(
      res,
      await getObject(`audio/output/${sessionId}/chunk_${String(Number(index)).padStart(3, '0')}.wav`),
    );
  } catch (err) {
    const status = err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404 ? 404 : 500;
    res.status(status).json({ error: status === 404 ? 'Chunk not ready or session not found' : err.message });
  }
});

router.get('/inference/chunk-preview/:sessionId/:index', async (req, res) => {
  const { sessionId, index } = req.params;
  if (!/^[A-Za-z0-9-]+$/u.test(sessionId) || !/^\d+$/u.test(index)) {
    return res.status(400).json({ error: 'Invalid chunk preview request' });
  }
  try {
    const filePath = getSessionChunkPreviewPath(sessionId, Number(index));
    if (isPathInside(filePath, path.join(LOCAL_TEMP_ROOT, 'inference')) && fs.existsSync(filePath)) {
      return sendAudioFile(res, filePath);
    }
    return sendAudioBuffer(
      res,
      await getObject(`audio/output/${sessionId}/chunk_preview_${String(Number(index)).padStart(3, '0')}.wav`),
    );
  } catch (err) {
    const status = err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404 ? 404 : 500;
    return res.status(status).json({ error: status === 404 ? 'Chunk preview not ready or session not found' : err.message });
  }
});

router.get('/inference/chunk-version/:sessionId/:index/:versionId', (req, res) => {
  const { sessionId, index, versionId } = req.params;
  if (!/^[A-Za-z0-9-]+$/u.test(sessionId) || !/^\d+$/u.test(index) || !/^[A-Za-z0-9-]+$/u.test(versionId)) {
    return res.status(400).json({ error: 'Invalid chunk version path' });
  }
  const filePath = getSessionChunkVersionPath(sessionId, Number(index), versionId);
  if (!isPathInside(filePath, path.join(LOCAL_TEMP_ROOT, 'inference')) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Chunk version not found' });
  }
  return sendAudioFile(res, filePath);
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
