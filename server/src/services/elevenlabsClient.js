import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_DEFAULT_MODEL,
} from '../config.js';

const BASE_URL_V1 = 'https://api.elevenlabs.io/v1';
const BASE_URL_V2 = 'https://api.elevenlabs.io/v2';

class ElevenLabsError extends Error {
  constructor(message, { statusCode = 502, upstreamStatus, cause } = {}) {
    super(message);
    this.name = 'ElevenLabsError';
    this.statusCode = statusCode;
    this.upstreamStatus = upstreamStatus;
    this.cause = cause;
  }
}

function requireApiKey() {
  if (!ELEVENLABS_API_KEY) {
    throw new ElevenLabsError(
      'ELEVENLABS_API_KEY is not set. Add it to server/.env and restart the server.',
      { statusCode: 503 }
    );
  }
}

function authHeaders(extra = {}) {
  requireApiKey();
  return { 'xi-api-key': ELEVENLABS_API_KEY, ...extra };
}

async function readError(res) {
  const text = await res.text();
  if (!text) return res.statusText;

  try {
    const parsed = JSON.parse(text);
    return parsed.detail?.message
      || parsed.message
      || parsed.error
      || JSON.stringify(parsed.detail || parsed);
  } catch {
    return text;
  }
}

function addPermissionHint(details) {
  const permissionMatch = details.match(/permission\s+([a-z0-9_]+)/iu);
  if (!permissionMatch) return details;

  const permission = permissionMatch[1];
  return `${details} Update ELEVENLABS_API_KEY to a key with the ${permission} permission enabled, then restart the server.`;
}

function getNetworkFailureMessage(action, err) {
  const code = err.cause?.code || err.code;
  if (code === 'EACCES') {
    return `Cannot reach ElevenLabs while ${action} (EACCES). Check that outbound HTTPS access to api.elevenlabs.io is allowed by your network, firewall, proxy, or sandbox.`;
  }
  if (code) {
    return `Cannot reach ElevenLabs while ${action} (${code}). Check your internet connection, DNS, firewall, or proxy settings.`;
  }
  return `Cannot reach ElevenLabs while ${action}: ${err.message}`;
}

function getUpstreamStatusCode(status) {
  if (status === 401 || status === 403) return 401;
  if (status === 429) return 429;
  if (status >= 400 && status < 500) return 400;
  return 502;
}

async function requestElevenLabs(url, options, action) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new ElevenLabsError(getNetworkFailureMessage(action, err), {
      statusCode: 503,
      cause: err,
    });
  }

  if (!res.ok) {
    const details = addPermissionHint(await readError(res));
    throw new ElevenLabsError(`ElevenLabs ${action} failed: ${res.status} - ${details}`, {
      statusCode: getUpstreamStatusCode(res.status),
      upstreamStatus: res.status,
    });
  }

  return res;
}

export async function listVoices() {
  const url = new URL(`${BASE_URL_V2}/voices`);
  url.searchParams.set('page_size', '100');
  url.searchParams.set('include_total_count', 'false');

  const res = await requestElevenLabs(url, { headers: authHeaders() }, 'listVoices');
  const data = await res.json();
  return (data.voices || [])
    .filter(v => ['cloned', 'professional'].includes(v.category))
    .map(v => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category,
      fineTuning: v.fine_tuning || null,
    }));
}

export async function cloneVoice(name, multerFiles) {
  const form = new FormData();
  form.append('name', name);
  form.append('description', `Instant voice clone for ${name}`);

  for (const file of multerFiles) {
    const blob = new Blob([file.buffer], { type: file.mimetype || 'audio/wav' });
    form.append('files', blob, file.originalname);
  }

  const res = await requestElevenLabs(`${BASE_URL_V1}/voices/add`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  }, 'create instant voice clone');

  const data = await res.json();
  return {
    voiceId: data.voice_id,
    name,
    category: 'cloned',
    requiresVerification: data.requires_verification ?? false,
  };
}

export async function deleteVoice(voiceId) {
  await requestElevenLabs(`${BASE_URL_V1}/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }, 'deleteVoice');
}

export async function textToSpeech(voiceId, text, modelId = ELEVENLABS_DEFAULT_MODEL) {
  return requestElevenLabs(
    `${BASE_URL_V1}/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text, model_id: modelId }),
    },
    'TTS'
  );
}
