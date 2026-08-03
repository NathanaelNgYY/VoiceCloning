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

// Live-chat authentication. Defaults to off so existing deployments keep working
// until the Entra app registration is in place and the client sends a token.
export const LIVE_AUTH_ENABLED = (process.env.LIVE_AUTH_ENABLED || 'false') === 'true';
export const ENTRA_TENANT_ID = process.env.ENTRA_TENANT_ID || '';
// The API's app ID URI (api://<clientId>), not the bare client ID.
export const ENTRA_AUDIENCE = process.env.ENTRA_AUDIENCE || '';
export const ENTRA_ALLOWED_EMAIL_DOMAINS = (process.env.ENTRA_ALLOWED_EMAIL_DOMAINS || '')
  .split(',')
  .map((domain) => domain.trim())
  .filter(Boolean);
// Separate credential for the load tests, which have no interactive sign-in.
// Empty disables the bypass; it is never implied by LIVE_AUTH_ENABLED.
export const LIVE_AUTH_LOADTEST_SECRET = process.env.LIVE_AUTH_LOADTEST_SECRET || '';

// Transcript storage. Empty table name disables it entirely — the gateway runs
// exactly as before, which is what every local dev run needs.
export const TRANSCRIPT_TABLE_NAME = process.env.TRANSCRIPT_TABLE_NAME || '';
export const TRANSCRIPT_TABLE_REGION = process.env.TRANSCRIPT_TABLE_REGION || 'ap-northeast-2';
// Identifiable rows expire after 90 days; long-term research use is served by a
// de-identified export instead (scripts/export-transcripts-deidentified.mjs),
// which is not personal data and needs no expiry. Defaults to 90 rather than 0
// so that forgetting to configure it cannot silently mean indefinite retention
// of health-adjacent free text about named students. Set 0 to disable expiry.
export const TRANSCRIPT_TTL_DAYS = Number.parseInt(process.env.TRANSCRIPT_TTL_DAYS || '90', 10);
// Load-test sessions are dropped by default so rehearsals do not bury real
// transcripts under thousands of synthetic turns.
export const TRANSCRIPT_STORE_SYNTHETIC = process.env.TRANSCRIPT_STORE_SYNTHETIC === 'true';
