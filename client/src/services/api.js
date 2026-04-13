import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

// Upload training audio files
export function uploadFiles(expName, files) {
  const formData = new FormData();
  formData.append('expName', expName);
  for (const file of files) {
    formData.append('files', file);
  }
  return api.post('/upload', formData);
}

// Upload reference audio for inference
export function uploadRefAudio(file) {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/upload-ref', formData);
}

// Start training pipeline
export function startTraining(params) {
  return api.post('/train', params);
}

// Stop training
export function stopTraining(sessionId) {
  return api.post('/train/stop', { sessionId });
}

// Get current training state
export function getCurrentTraining() {
  return api.get('/train/current');
}

// Get available models
export function getModels() {
  return api.get('/models');
}

// Load model weights
export function selectModels(gptPath, sovitsPath) {
  return api.post('/models/select', { gptPath, sovitsPath });
}

// Transcribe reference audio
export function transcribeAudio(filePath, language = 'auto') {
  return api.post('/transcribe', { filePath, language });
}

// Synthesize speech
export async function synthesize(params) {
  const res = await api.post('/inference', params, {
    responseType: 'blob',
    validateStatus: () => true, // don't throw on non-2xx
  });

  // If server returned an error, read the blob as JSON text
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

  // Ensure blob has correct audio MIME type
  return new Blob([res.data], { type: 'audio/wav' });
}

// Start streaming generation (returns sessionId)
export function startGeneration(params) {
  return api.post('/inference/generate', params);
}

export function getCurrentInference() {
  return api.get('/inference/current');
}

// Download final WAV from streaming generation
export async function getGenerationResult(sessionId) {
  const res = await api.get(`/inference/result/${sessionId}`, { responseType: 'blob' });
  return new Blob([res.data], { type: 'audio/wav' });
}

// Cancel an in-progress streaming generation
export function cancelGeneration(sessionId) {
  return api.post('/inference/cancel', { sessionId });
}

// Check inference server status
export function getInferenceStatus() {
  return api.get('/inference/status');
}

// Get training audio files for an experiment
export function getTrainingAudioFiles(expName) {
  return api.get(`/training-audio/${encodeURIComponent(expName)}`);
}

// Get URL for streaming a training audio file
export function getTrainingAudioUrl(expName, filename) {
  return `/api/training-audio/file/${encodeURIComponent(expName)}/${encodeURIComponent(filename)}`;
}

export function getUploadedRefAudioUrl(filePath) {
  return `/api/ref-audio?filePath=${encodeURIComponent(filePath)}`;
}
