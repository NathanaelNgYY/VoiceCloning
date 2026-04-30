import axios from 'axios';
import { API_BASE_URL } from '@/lib/runtimeConfig';

const api = axios.create({ baseURL: API_BASE_URL });

const SELECTED_VOICE_KEY = 'elevenlabs-selected-voice';

export function getSelectedVoiceId() {
  return localStorage.getItem(SELECTED_VOICE_KEY) || '';
}

export function setSelectedVoiceId(voiceId) {
  localStorage.setItem(SELECTED_VOICE_KEY, voiceId);
}

// ── Voices ──

export function getVoices() {
  return api.get('/voices');
}

export async function cloneVoice(name, files) {
  const formData = new FormData();
  formData.append('name', name);
  for (const file of files) {
    formData.append('files', file);
  }
  return api.post('/voices/clone', formData);
}

export function deleteVoice(voiceId) {
  return api.delete(`/voices/${voiceId}`);
}

// ── TTS ──

export async function tts(voiceId, text) {
  const res = await api.post('/tts', { voiceId, text }, {
    responseType: 'blob',
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    const errText = await res.data.text();
    let message;
    try { message = JSON.parse(errText).error; } catch { message = errText; }
    throw new Error(message || `TTS failed with status ${res.status}`);
  }

  return new Blob([res.data], { type: 'audio/mpeg' });
}

// ── Live chat synthesis (called by useLiveSpeech) ──

export async function synthesize({ voiceId, text }) {
  return tts(voiceId, text);
}

export async function synthesizeSentence({ voiceId, text }) {
  return tts(voiceId, text);
}
