import { sseManager } from './sseManager.js';
import { trainingState } from './trainingState.js';

export function formatTrainingCloudWatchLog({
  sessionId,
  stream = 'stdout',
  data = '',
  timestamp = Date.now(),
}) {
  return JSON.stringify({
    service: 'gpu-worker',
    logType: 'training',
    sessionId,
    stream,
    message: String(data || '').trimEnd(),
    timestamp,
  });
}

export function recordTrainingLog(sessionId, { stream = 'stdout', data = '', timestamp = Date.now() } = {}) {
  const payload = { stream, data, timestamp };
  trainingState.appendLog(payload);
  sseManager.send(sessionId, 'log', payload);

  const line = formatTrainingCloudWatchLog({ sessionId, stream, data, timestamp });
  if (stream === 'stderr') {
    console.error(line);
  } else {
    console.log(line);
  }

  return payload;
}
