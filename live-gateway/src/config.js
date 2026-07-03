import fs from 'fs';
import { fileURLToPath } from 'url';

const CONFIG_FILE = fileURLToPath(new URL('../.env', import.meta.url));

function loadOptionalEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadOptionalEnvFile(CONFIG_FILE);

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
export const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime';
export const OPENAI_REALTIME_SYSTEM_PROMPT = process.env.OPENAI_REALTIME_SYSTEM_PROMPT
  || 'You are a casual, helpful assistant. Keep replies concise and conversational.';
export const OPENAI_REALTIME_VAD = process.env.OPENAI_REALTIME_VAD || 'semantic_vad';
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.0-flash';
export const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
export const PORT = Number.parseInt(process.env.PORT || '3002', 10);
export const SYSTEM_PROMPT_STORE_PATH = process.env.SYSTEM_PROMPT_STORE_PATH
  || './data/system-prompt.json';
