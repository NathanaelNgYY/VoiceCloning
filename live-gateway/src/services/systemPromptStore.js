import fs from 'fs';
import path from 'path';
import { SYSTEM_PROMPT_STORE_PATH } from '../config.js';

let activePath = SYSTEM_PROMPT_STORE_PATH;
let current = null;
let loaded = false;

export function loadSystemPrompt() {
  try {
    const parsed = JSON.parse(fs.readFileSync(activePath, 'utf-8'));
    current = typeof parsed?.systemPrompt === 'string' ? parsed.systemPrompt : null;
  } catch {
    // Missing or unreadable/corrupt file → treat as unset.
    current = null;
  }
  loaded = true;
  return current;
}

export function getSystemPrompt() {
  if (!loaded) {
    loadSystemPrompt();
  }
  return current;
}

export function setSystemPrompt(value) {
  if (typeof value !== 'string') {
    throw new TypeError('systemPrompt must be a string');
  }
  fs.mkdirSync(path.dirname(activePath), { recursive: true });
  fs.writeFileSync(activePath, JSON.stringify({ systemPrompt: value }), 'utf-8');
  current = value;
  loaded = true;
  return current;
}

export function __setStorePathForTests(nextPath) {
  activePath = nextPath;
  current = null;
  loaded = false;
}
