import axios from 'axios';
import { GPU_WORKER_HOST, GPU_WORKER_PORT } from '../config.js';

function getBaseUrl() {
  return `http://${GPU_WORKER_HOST}:${GPU_WORKER_PORT}`;
}

const client = axios.create({ timeout: 300_000 });

export const gpuWorkerClient = {
  async startTraining(params) {
    const res = await client.post(`${getBaseUrl()}/train`, params);
    return res.data.sessionId;
  },

  async stopTraining(sessionId) {
    await client.post(`${getBaseUrl()}/train/stop`, { sessionId });
  },

  async relayProgress(workerSessionId, localSessionId, sseManager, trainingState) {
    return new Promise((resolve, reject) => {
      const url = `${getBaseUrl()}/train/progress/${workerSessionId}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('GPU Worker progress stream timed out'));
      }, 24 * 60 * 60 * 1000); // 24h max training time

      fetch(url, { signal: controller.signal }).then(async (response) => {
        if (!response.ok) {
          clearTimeout(timeout);
          reject(new Error(`GPU Worker returned ${response.status}`));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6));
                sseManager.send(localSessionId, currentEvent, data);

                // Update training state based on event
                if (currentEvent === 'step-start') {
                  trainingState.setStepStatus(data.step, data.status, data.detail || '');
                } else if (currentEvent === 'step-complete') {
                  trainingState.setStepStatus(data.step, data.code === 0 ? 'done' : 'error');
                } else if (currentEvent === 'log') {
                  trainingState.appendLog(data);
                } else if (currentEvent === 'pipeline-complete') {
                  trainingState.setStatus('complete');
                } else if (currentEvent === 'error') {
                  trainingState.setError(data.message);
                }
              } catch { /* skip malformed data */ }
              currentEvent = '';
            }
          }
        }

        clearTimeout(timeout);
        resolve();
      }).catch((err) => {
        clearTimeout(timeout);
        if (err.name === 'AbortError') return;
        reject(err);
      });
    });
  },

  async transcribe(s3Key, language = 'auto') {
    const res = await client.post(`${getBaseUrl()}/transcribe`, { s3Key, language });
    return res.data;
  },

  async downloadModel(s3Key) {
    const res = await client.post(`${getBaseUrl()}/models/download`, { s3Key });
    return res.data;
  },
};
