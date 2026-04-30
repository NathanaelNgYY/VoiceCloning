import { Router } from 'express';
import { textToSpeech } from '../services/elevenlabsClient.js';

const router = Router();

router.post('/tts', async (req, res) => {
  const { voiceId, text, modelId } = req.body;
  if (!voiceId) return res.status(400).json({ error: 'voiceId is required' });
  if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
  try {
    const elevenRes = await textToSpeech(voiceId, text.trim(), modelId);
    const buffer = Buffer.from(await elevenRes.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.end(buffer);
  } catch (err) {
    res.status(err.statusCode || 502).json({ error: err.message });
  }
});

export default router;
