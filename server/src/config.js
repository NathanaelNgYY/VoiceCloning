import path from 'path';
import { fileURLToPath } from 'url';
import { loadOptionalEnvFile } from './utils/env.js';

const CONFIG_FILE = fileURLToPath(new URL('../.env', import.meta.url));
loadOptionalEnvFile(CONFIG_FILE);

function readEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function parseIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseListEnv(value) {
  if (!value) return [];
  return value.split(',').map(entry => entry.trim()).filter(Boolean);
}

const SERVER_DIR = path.dirname(CONFIG_FILE);
const PROJECT_ROOT = path.resolve(SERVER_DIR, '..');
const NODE_ENV = readEnv('NODE_ENV') || 'development';

const OPENAI_API_KEY = readEnv('OPENAI_API_KEY');
const OPENAI_REALTIME_MODEL = readEnv('OPENAI_REALTIME_MODEL') || 'gpt-4o-realtime-preview';
const OPENAI_REALTIME_VAD = (() => {
  const v = readEnv('OPENAI_REALTIME_VAD').trim().toLowerCase();
  return ['semantic_vad', 'server_vad'].includes(v) ? v : 'semantic_vad';
})();
const OPENAI_REALTIME_SYSTEM_PROMPT =
  readEnv('OPENAI_REALTIME_SYSTEM_PROMPT') ||
  'You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English.';

const ELEVENLABS_API_KEY = readEnv('ELEVENLABS_API_KEY');
const ELEVENLABS_DEFAULT_MODEL = readEnv('ELEVENLABS_DEFAULT_MODEL') || 'eleven_turbo_v2_5';

const SERVER_HOST = readEnv('SERVER_HOST', 'HOST') || '0.0.0.0';
const SERVER_PORT = parseIntegerEnv(readEnv('PORT', 'SERVER_PORT'), 3000);
const TRUST_PROXY = parseBooleanEnv(readEnv('TRUST_PROXY'), true);
const SERVE_CLIENT_DIST = parseBooleanEnv(readEnv('SERVE_CLIENT_DIST'), NODE_ENV === 'production');
const CLIENT_DIST_DIR = readEnv('CLIENT_DIST_DIR')
  ? path.resolve(readEnv('CLIENT_DIST_DIR'))
  : path.resolve(PROJECT_ROOT, 'client', 'dist');
const CORS_ORIGINS = parseListEnv(readEnv('CORS_ORIGINS'));
const ALLOW_ALL_CORS = CORS_ORIGINS.includes('*');

function getConfigError() {
  if (!ELEVENLABS_API_KEY) return 'ELEVENLABS_API_KEY is not set. Add it to server/.env';
  return null;
}

const startupError = getConfigError();
if (startupError) console.warn(`[config] ${startupError}`);

export {
  NODE_ENV,
  PROJECT_ROOT,
  OPENAI_API_KEY,
  OPENAI_REALTIME_MODEL,
  OPENAI_REALTIME_VAD,
  OPENAI_REALTIME_SYSTEM_PROMPT,
  ELEVENLABS_API_KEY,
  ELEVENLABS_DEFAULT_MODEL,
  SERVER_HOST,
  SERVER_PORT,
  TRUST_PROXY,
  SERVE_CLIENT_DIST,
  CLIENT_DIST_DIR,
  CORS_ORIGINS,
  ALLOW_ALL_CORS,
  getConfigError,
};
