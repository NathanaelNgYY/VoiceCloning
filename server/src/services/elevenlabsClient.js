import { ELEVENLABS_API_KEY, ELEVENLABS_DEFAULT_MODEL } from '../config.js';

const BASE_URL = 'https://api.elevenlabs.io/v1';

function authHeaders(extra = {}) {
  return { 'xi-api-key': ELEVENLABS_API_KEY, ...extra };
}

export async function listVoices() {
  const res = await fetch(`${BASE_URL}/voices`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`ElevenLabs listVoices failed: ${res.status}`);
  const data = await res.json();
  return data.voices
    .filter(v => v.category === 'cloned')
    .map(v => ({ voiceId: v.voice_id, name: v.name }));
}

export async function cloneVoice(name, multerFiles) {
  const form = new FormData();
  form.append('name', name);
  for (const file of multerFiles) {
    const blob = new Blob([file.buffer], { type: file.mimetype || 'audio/wav' });
    form.append('files', blob, file.originalname);
  }
  const res = await fetch(`${BASE_URL}/voices/add`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs cloneVoice failed: ${res.status} — ${text}`);
  }
  const data = await res.json();
  return { voiceId: data.voice_id, name };
}

export async function deleteVoice(voiceId) {
  const res = await fetch(`${BASE_URL}/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`ElevenLabs deleteVoice failed: ${res.status}`);
}

export async function textToSpeech(voiceId, text, modelId = ELEVENLABS_DEFAULT_MODEL) {
  const res = await fetch(
    `${BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text, model_id: modelId }),
    }
  );
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`ElevenLabs TTS failed: ${res.status} — ${errorText}`);
  }
  return res;
}
