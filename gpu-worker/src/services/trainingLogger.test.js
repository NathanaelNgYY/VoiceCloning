import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTrainingCloudWatchLog } from './trainingLogger.js';

test('formatTrainingCloudWatchLog creates structured backend training log lines', () => {
  assert.equal(
    formatTrainingCloudWatchLog({
      sessionId: 'session-123',
      stream: 'stderr',
      data: 'Step failed\n',
      timestamp: 1715000000000,
    }),
    JSON.stringify({
      service: 'gpu-worker',
      logType: 'training',
      sessionId: 'session-123',
      stream: 'stderr',
      message: 'Step failed',
      timestamp: 1715000000000,
    }),
  );
});
