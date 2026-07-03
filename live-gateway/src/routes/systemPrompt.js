import { Router } from 'express';
import { getSystemPrompt, setSystemPrompt } from '../services/systemPromptStore.js';

export const SYSTEM_PROMPT_PATH = '/api/live/chat/system-prompt';

export function handleGetSystemPrompt(_req, res) {
  res.json({ systemPrompt: getSystemPrompt() });
}

export function handlePutSystemPrompt(req, res) {
  const value = req?.body?.systemPrompt;
  if (typeof value !== 'string') {
    res.status(400).json({ error: 'systemPrompt must be a string' });
    return;
  }
  try {
    const saved = setSystemPrompt(value);
    res.json({ systemPrompt: saved });
  } catch {
    res.status(500).json({ error: 'Failed to persist system prompt' });
  }
}

export function createSystemPromptRouter() {
  const router = Router();
  router.get(SYSTEM_PROMPT_PATH, handleGetSystemPrompt);
  router.put(SYSTEM_PROMPT_PATH, handlePutSystemPrompt);
  return router;
}
