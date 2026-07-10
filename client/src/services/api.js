import axios from 'axios';
import {
  createVoiceProfileBrowserDebugSummary,
  writeVoiceProfileBrowserDebug,
} from '../lib/voiceProfileDebug.js';
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

// S3 presigned upload helpers

async function getPresignedUploadUrls(expName, files) {
  const fileList = files.map(f => ({ name: f.name, type: f.type, size: f.size }));
  const res = await api.post('/upload/presign', { expName, files: fileList });
  return res.data;
}

async function uploadFileToS3(presignedUrl, file) {
  const response = await fetch(presignedUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'audio/wav' },
  });
  if (!response.ok) {
    throw new Error(`S3 upload failed (${response.status})`);
  }
}

async function confirmUpload(expName, keys) {
  const res = await api.post('/upload/confirm', { expName, keys });
  return res.data;
}

function assertConfirmedUpload(expectedCount, confirmation, messagePrefix) {
  if (Number(confirmation?.confirmed) !== Number(expectedCount)) {
    throw new Error(`${messagePrefix} confirmed ${confirmation?.confirmed || 0} of ${expectedCount} uploaded file(s).`);
  }
}

// Training audio upload

export async function uploadFiles(expName, files) {
  await getStorageMode();

  if (isS3Mode()) {
    const { uploads } = await getPresignedUploadUrls(expName, Array.from(files));
    await Promise.all(uploads.map(({ url }, i) => uploadFileToS3(url, files[i])));
    const keys = uploads.map(u => u.key);
    const confirmation = await confirmUpload(expName, keys);
    assertConfirmedUpload(keys.length, confirmation, 'Training upload');
    return { data: { message: `${confirmation.confirmed} file(s) uploaded`, files: confirmation.files } };
  }

  const formData = new FormData();
  formData.append('expName', expName);
  for (const file of files) {
    formData.append('files', file);
  }
  return api.post('/upload', formData);
}

// Reference audio upload

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

export async function getTrainingLibraryFiles() {
  await getStorageMode();
  if (!isS3Mode()) {
    return { data: { files: [] } };
  }
  return api.get('/training-library');
}

export async function uploadTrainingLibraryFile(file) {
  await getStorageMode();
  if (!isS3Mode()) {
    throw new Error('Shared training storage requires S3 mode.');
  }

  const presignRes = await api.post('/training-library/presign', {
    filename: file.name,
    type: file.type,
  });
  const { id, key, url, filename } = presignRes.data;
  await uploadFileToS3(url, file);
  return api.post('/training-library/confirm', {
    id,
    key,
    filename,
    contentType: file.type || 'audio/wav',
  });
}

export async function replaceTrainingLibraryFile(fileId, file) {
  await getStorageMode();
  if (!isS3Mode()) {
    throw new Error('Shared training storage requires S3 mode.');
  }

  const presignRes = await api.post(`/training-library/${encodeURIComponent(fileId)}/replace-presign`, {
    filename: file.name,
    type: file.type,
  });
  const { key, url, filename } = presignRes.data;
  await uploadFileToS3(url, file);
  return api.post(`/training-library/${encodeURIComponent(fileId)}/replace-confirm`, {
    key,
    filename,
    contentType: file.type || 'audio/wav',
  });
}

export async function deleteTrainingLibraryFile(fileId) {
  await getStorageMode();
  if (!isS3Mode()) {
    throw new Error('Shared training storage requires S3 mode.');
  }
  return api.delete(`/training-library/${encodeURIComponent(fileId)}`);
}

export async function snapshotTrainingLibraryFiles(expName, fileIds) {
  await getStorageMode();
  if (!isS3Mode()) {
    throw new Error('Shared training storage requires S3 mode.');
  }
  return api.post('/training-library/snapshot', { expName, fileIds });
}

// Training

export function startTraining(params) {
  return api.post('/train', params);
}

export function stopTraining(sessionId) {
  return api.post('/train/stop', { sessionId });
}

export function getCurrentTraining() {
  return api.get('/train/current');
}

export function getTrainingRunMetadata(expName) {
  return api.get(`/train/metadata/${encodeURIComponent(expName)}`);
}

// Models

export function getModels() {
  return api.get('/models');
}

export function selectModels(gptPath, sovitsPath, options = {}) {
  const refAudioPath = String(options?.ref_audio_path || '').trim();
  const voiceProfileId = String(options?.voiceProfileId || '').trim();
  const auxRefAudioPaths = Array.isArray(options?.aux_ref_audio_paths)
    ? options.aux_ref_audio_paths.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5)
    : [];

  if (isS3Mode()) {
    return api.post('/models/select', {
      gptKey: gptPath,
      sovitsKey: sovitsPath,
      ...(voiceProfileId ? { voiceProfileId } : {}),
      ...(refAudioPath ? {
        ref_audio_path: refAudioPath,
        aux_ref_audio_paths: auxRefAudioPaths,
      } : {}),
    });
  }
  return api.post('/models/select', {
    gptPath,
    sovitsPath,
    ...(voiceProfileId ? { voiceProfileId } : {}),
    ...(refAudioPath ? {
      ref_audio_path: refAudioPath,
      aux_ref_audio_paths: auxRefAudioPaths,
    } : {}),
  });
}

export function activateVoiceProfile(profile) {
  const requestDebug = createVoiceProfileBrowserDebugSummary({
    context: 'activate request',
    voiceProfileId: profile?.voiceProfileId,
    displayName: profile?.displayName,
    refAudioPath: profile?.ref_audio_path,
    promptText: profile?.prompt_text,
    promptLang: profile?.prompt_lang,
    textLang: profile?.text_lang,
    auxRefAudioPaths: profile?.aux_ref_audio_paths,
    defaults: profile?.defaults,
  });
  writeVoiceProfileBrowserDebug('activate request', requestDebug);

  return api.post('/voice-profile/activate', profile)
    .then((response) => {
      writeVoiceProfileBrowserDebug('activate response', createVoiceProfileBrowserDebugSummary({
        context: 'activate response',
        voiceProfileId: profile?.voiceProfileId,
        displayName: profile?.displayName,
        refAudioPath: profile?.ref_audio_path,
        promptText: profile?.prompt_text,
        promptLang: profile?.prompt_lang,
        textLang: profile?.text_lang,
        auxRefAudioPaths: profile?.aux_ref_audio_paths,
        defaults: profile?.defaults,
        summary: response?.data || null,
      }));
      return response;
    })
    .catch((error) => {
      writeVoiceProfileBrowserDebug('activate error', {
        ...requestDebug,
        context: 'activate error',
        error: error?.response?.data?.error || error?.message || 'Unknown error',
        status: error?.response?.status || null,
      });
      throw error;
    });
}

export function getActiveVoiceProfile() {
  return api.get('/voice-profile/active');
}

export function getFullActiveVoiceProfile() {
  return api.get('/voice-profile/active', {
    params: { full: 1 },
  });
}

export function getVoiceProfileConfigs(voiceProfileId) {
  return api.get(`/voice-profile/configs/${encodeURIComponent(voiceProfileId)}`);
}

export function saveVoiceProfileConfig(voiceProfileId, configId, config) {
  return api.post(
    `/voice-profile/configs/${encodeURIComponent(voiceProfileId)}/${encodeURIComponent(configId)}`,
    config,
  );
}

export function deleteVoiceProfileConfig(voiceProfileId, configId) {
  return api.post(`/voice-profile/configs/${encodeURIComponent(voiceProfileId)}/${encodeURIComponent(configId)}`, {
    delete: true,
  });
}

// Transcription

export function transcribeAudio(filePath, language = 'auto') {
  return api.post('/transcribe', { filePath, language });
}

// Inference

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

  return {
    blob: new Blob([res.data], { type: 'audio/wav' }),
  };
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

  return {
    blob: new Blob([res.data], { type: 'audio/wav' }),
  };
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

export async function getGenerationResultSource(sessionId) {
  await getStorageMode();

  if (isS3Mode()) {
    return {
      url: resolveApiPath(`/api/inference/result/${encodeURIComponent(sessionId)}?audio=1`),
      revoke: false,
    };
  }

  const res = await api.get(`/inference/result/${sessionId}`, {
    responseType: 'blob',
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    throw new Error(`Generated audio is not ready yet (${res.status})`);
  }
  const contentType = String(res.headers?.['content-type'] || '');
  if (contentType.includes('application/json')) {
    const data = JSON.parse(await res.data.text());
    if (data?.url) return { url: data.url, revoke: false };
    throw new Error('Generated audio response did not include a playable URL.');
  }
  return { url: URL.createObjectURL(new Blob([res.data], { type: 'audio/wav' })), revoke: true };
}

export async function getGenerationResult(sessionId) {
  await getStorageMode();

  if (isS3Mode()) {
    const res = await api.get(`/inference/result/${sessionId}`);
    const { url } = res.data;
    return fetchGeneratedAudio(url);
  }

  const res = await api.get(`/inference/result/${sessionId}`, {
    responseType: 'blob',
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    throw new Error(`Generated audio is not ready yet (${res.status})`);
  }
  const contentType = String(res.headers?.['content-type'] || '');
  if (contentType.includes('application/json')) {
    const data = JSON.parse(await res.data.text());
    if (data?.url) return fetchGeneratedAudio(data.url);
    throw new Error('Generated audio response did not include a playable URL.');
  }
  return new Blob([res.data], { type: 'audio/wav' });
}

export function getPronunciationDictionary(category = 'general') {
  return api.get('/pronunciation-dictionary', { params: { category } });
}

export function savePronunciationEntry(entry) {
  return api.post('/pronunciation-dictionary', entry);
}

export function deletePronunciationEntry(entry) {
  return api.post('/pronunciation-dictionary', { ...entry, action: 'delete' });
}

// Scan input text for words the engine would pronounce by neural guess (not from the
// dictionary) — i.e. words that likely need an ARPAbet override. Returns
// { flagged: string[], totalWords, coveredWords, dictionaryLoaded }.
export function scanOovWords(text) {
  return api.post('/inference/scan-oov', { text });
}

export async function getInferenceChunk(sessionId, index) {
  const res = await axios.get(resolveApiPath(
    `/api/inference/chunk/${encodeURIComponent(sessionId)}/${encodeURIComponent(index)}`,
  ), {
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

export function startInferenceServer() {
  return api.post('/inference/start');
}

export function stopInferenceServer() {
  return api.post('/inference/stop');
}

export function getInstanceStatus() {
  return api.get('/instance/status');
}

export function startInstance() {
  return api.post('/instance/start');
}

// Training audio browser

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
