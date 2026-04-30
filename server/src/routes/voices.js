import { Router } from 'express';
import multer from 'multer';
import { listVoices, cloneVoice, deleteVoice } from '../services/elevenlabsClient.js';

const router = Router();
const ACCEPTED_AUDIO_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.oga', '.opus', '.flac', '.m4a', '.aac', '.aiff', '.webm'];

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter(_req, file, cb) {
    const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    cb(null, ACCEPTED_AUDIO_EXTENSIONS.includes(ext) || file.mimetype.startsWith('audio/'));
  },
});

router.get('/voices', async (_req, res) => {
  try {
    const voices = await listVoices();
    res.json(voices);
  } catch (err) {
    res.status(err.statusCode || 502).json({ error: err.message });
  }
});

router.post('/voices/clone', upload.array('files', 20), async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!req.files?.length) return res.status(400).json({ error: 'at least one audio file is required' });
  try {
    const voice = await cloneVoice(name.trim(), req.files);
    res.json(voice);
  } catch (err) {
    res.status(err.statusCode || 502).json({ error: err.message });
  }
});

router.delete('/voices/:voiceId', async (req, res) => {
  try {
    await deleteVoice(req.params.voiceId);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 502).json({ error: err.message });
  }
});

export default router;
