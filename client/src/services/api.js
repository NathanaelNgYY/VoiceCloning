import axios from 'axios';
import { API_BASE_URL, resolveApiPath, getStorageMode, isS3Mode } from '@/lib/runtimeConfig';

const api = axios.create({
  baseURL: API_BASE_URL,
});

const METHODS_REQUIRING_PAYLOAD_HASH = new Set(['post', 'put', 'patch', 'delete']);

function isSpecialBody(data) {
  return (
    (typeof FormData !== 'undefined' && data instanceof FormData)
    || (typeof Blob !== 'undefined' && data instanceof Blob)
    || (typeof File !== 'undefined' && data instanceof File)
    || (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer)
    || (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams)
  );
}

function isJsonBody(data) {
  if (data == null) return true;
  if (isSpecialBody(data)) return false;
  if (typeof data === 'string') return true;
  if (typeof data === 'number' || typeof data === 'boolean') return true;
  if (Array.isArray(data)) return true;
  return Object.prototype.toString.call(data) === '[object Object]';
}

function serializeJsonBody(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  return JSON.stringify(data);
}

function setHeader(headers, name, value) {
  if (typeof headers.set === 'function') {
    headers.set(name, value);
    return;
  }
  headers[name] = value;
}

async function sha256Hex(text) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is unavailable; cannot sign Lambda Function URL POST body');
  }

  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

api.interceptors.request.use(async (config) => {
  const method = String(config.method || 'get').toLowerCase();
  if (!METHODS_REQUIRING_PAYLOAD_HASH.has(method) || !isJsonBody(config.data)) {
    return config;
  }

  const body = serializeJsonBody(config.data);
  config.data = body;
  config.transformRequest = [(data) => data];
  config.headers = config.headers || {};
  setHeader(config.headers, 'Content-Type', 'application/json');
  setHeader(config.headers, 'x-amz-content-sha256', await sha256Hex(body));
  return config;
});

// Initialize storage mode on first import (non-blocking)
getStorageMode();

// ── S3 presigned upload helpers ──

async function getPresignedUploadUrls(expName, files) {
  const fileList = files.map(f => ({ name: f.name, type: f.type, size: f.size }));
  const res = await api.post('/upload/presign', { expName, files: fileList });
  return res.data;
}

async function uploadFileToS3(presignedUrl, file) {
  await fetch(presignedUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'audio/wav' },
  });
}

async function confirmUpload(expName, keys) {
  const res = await api.post('/upload/confirm', { expName, keys });
  return res.data;
}

// ── Training audio upload ──

export async function uploadFiles(expName, files) {
  await getStorageMode();

  if (isS3Mode()) {
    const { uploads } = await getPresignedUploadUrls(expName, Array.from(files));
    await Promise.all(uploads.map(({ url }, i) => uploadFileToS3(url, files[i])));
    const keys = uploads.map(u => u.key);
    const confirmation = await confirmUpload(expName, keys);
    return { data: { message: `${confirmation.confirmed} file(s) uploaded`, files: confirmation.files } };
  }

  const formData = new FormData();
  formData.append('expName', expName);
  for (const file of files) {
    formData.append('files', file);
  }
  return api.post('/upload', formData);
}

// ── Reference audio upload ──

export async function uploadRefAudio(file) {
  await getStorageMode();

  if (isS3Mode()) {
    const presignRes = await api.post('/upload-ref/presign', {
      filename: file.name,
      type: file.type,
    });
    const { url, key } = presignRes.data;
    await uploadFileToS3(url, file);
    const confirmRes = await api.post('/upload-ref/confirm', { key });
    return { data: { path: confirmRes.data.key, filename: confirmRes.data.filename } };
  }

  const formData = new FormData();
  formData.append('file', file);
  return api.post('/upload-ref', formData);
}

// ── Live audio upload ──

// ── Training ──

export function startTraining(params) {
  return api.post('/train', params);
}

export function stopTraining(sessionId) {
  return api.post('/train/stop', { sessionId });
}

export function getCurrentTraining() {
  return api.get('/train/current');
}

// ── Models ──

export function getModels() {
  return api.get('/models');
}

export function selectModels(gptPath, sovitsPath) {
  if (isS3Mode()) {
    return api.post('/models/select', { gptKey: gptPath, sovitsKey: sovitsPath });
  }
  return api.post('/models/select', { gptPath, sovitsPath });
}

// ── Transcription ──

export function transcribeAudio(filePath, language = 'auto') {
  return api.post('/transcribe', { filePath, language });
}

// ── Inference ──

export async function synthesize(params) {
  const res = await api.post('/inference', params, {
    responseType: 'blob',
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    const text = await res.data.text();
    let message;
    try {
      message = JSON.parse(text).error;
    } catch {
      message = text;
    }
    throw new Error(message || `Request failed with status ${res.status}`);
  }

  return new Blob([res.data], { type: 'audio/wav' });
}

export async function synthesizeSentence(params) {
  const res = await api.post('/live/tts-sentence', params, {
    responseType: 'blob',
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    const text = await res.data.text();
    let message;
    try {
      message = JSON.parse(text).error;
    } catch {
      message = text;
    }
    throw new Error(message || `Request failed with status ${res.status}`);
  }

  return new Blob([res.data], { type: 'audio/wav' });
}

export function startGeneration(params) {
  return api.post('/inference/generate', params);
}

export function getCurrentInference() {
  return api.get('/inference/current');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGeneratedAudio(url, { attempts = 8, delayMs = 500 } = {}) {
  let lastStatus = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const audioRes = await fetch(url);
    lastStatus = audioRes.status;

    if (audioRes.ok) {
      const blob = await audioRes.blob();
      return new Blob([blob], { type: 'audio/wav' });
    }

    const canRetry = [403, 404, 409, 425].includes(audioRes.status);
    if (!canRetry || attempt === attempts) {
      break;
    }

    await sleep(delayMs * attempt);
  }

  throw new Error(`Generated audio is not ready yet (${lastStatus || 'network error'})`);
}

export async function getGenerationResult(sessionId) {
  await getStorageMode();

  if (isS3Mode()) {
    const res = await api.get(`/inference/result/${sessionId}`);
    const { url } = res.data;
    return fetchGeneratedAudio(url);
  }

  const res = await api.get(`/inference/result/${sessionId}`, { responseType: 'blob' });
  return new Blob([res.data], { type: 'audio/wav' });
}

export async function getInferenceChunk(sessionId, index) {
  const res = await api.get(`/inference/chunk/${sessionId}/${index}`, {
    responseType: 'blob',
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    throw new Error(`Chunk not available (${res.status})`);
  }
  return new Blob([res.data], { type: 'audio/wav' });
}

export function cancelGeneration(sessionId) {
  return api.post('/inference/cancel', { sessionId });
}

export function getInferenceStatus() {
  return api.get('/inference/status');
}

export function getInstanceStatus() {
  return api.get('/instance/status');
}

export function startInstance() {
  return api.post('/instance/start');
}

// ── Training audio browser ──

export function getTrainingAudioFiles(expName) {
  return api.get(`/training-audio/${encodeURIComponent(expName)}`);
}

export async function getTrainingAudioUrl(expName, filename) {
  await getStorageMode();

  if (isS3Mode()) {
    const res = await api.get(`/training-audio/file/${encodeURIComponent(expName)}/${encodeURIComponent(filename)}`);
    return res.data.url;
  }

  return resolveApiPath(`/api/training-audio/file/${encodeURIComponent(expName)}/${encodeURIComponent(filename)}`);
}

export async function getUploadedRefAudioUrl(filePath) {
  await getStorageMode();

  if (isS3Mode()) {
    const res = await api.get('/ref-audio', { params: { filePath } });
    return res.data.url;
  }

  return resolveApiPath(`/api/ref-audio?filePath=${encodeURIComponent(filePath)}`);
}
