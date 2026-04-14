import { resolveApiPath } from '@/lib/runtimeConfig';

export function connectSSE(sessionId, { onLog, onStepStart, onStepComplete, onComplete, onError }) {
  const es = new EventSource(resolveApiPath(`/api/train/status/${sessionId}`));

  es.addEventListener('log', (e) => {
    onLog?.(JSON.parse(e.data));
  });

  es.addEventListener('step-start', (e) => {
    onStepStart?.(JSON.parse(e.data));
  });

  es.addEventListener('step-complete', (e) => {
    onStepComplete?.(JSON.parse(e.data));
  });

  es.addEventListener('pipeline-complete', (e) => {
    onComplete?.(JSON.parse(e.data));
    es.close();
  });

  // Custom 'pipeline-error' event from our server (not the built-in connection error)
  es.addEventListener('error', (e) => {
    if (e.data) {
      onError?.(JSON.parse(e.data));
      es.close();
    }
    // If no e.data, this is a connection drop — let EventSource auto-reconnect
  });

  return es;
}

export function connectInferenceSSE(sessionId, { onStart, onChunkStart, onChunkComplete, onComplete, onError }) {
  const es = new EventSource(resolveApiPath(`/api/inference/progress/${sessionId}`));

  es.addEventListener('inference-start', (e) => {
    onStart?.(JSON.parse(e.data));
  });

  es.addEventListener('chunk-start', (e) => {
    onChunkStart?.(JSON.parse(e.data));
  });

  es.addEventListener('chunk-complete', (e) => {
    onChunkComplete?.(JSON.parse(e.data));
  });

  es.addEventListener('inference-complete', (e) => {
    onComplete?.(JSON.parse(e.data));
    es.close();
  });

  es.addEventListener('error', (e) => {
    if (e.data) {
      onError?.(JSON.parse(e.data));
      es.close();
    }
  });

  return es;
}
