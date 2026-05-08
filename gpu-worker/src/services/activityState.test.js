import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActivityStatus,
  refreshActivityWhileBusy,
  shouldTrackRequestActivity,
} from './activityState.js';

test('buildActivityStatus reports idle duration when worker is not busy', () => {
  const status = buildActivityStatus({
    lastActivityAt: 1_000,
    now: 7_000,
    trainingStatus: 'idle',
    inferenceStatus: 'complete',
  });

  assert.equal(status.busy, false);
  assert.equal(status.idleMs, 6_000);
});

test('buildActivityStatus stays busy during training or generation', () => {
  assert.equal(buildActivityStatus({ trainingStatus: 'running', trainingActive: true }).busy, true);
  assert.equal(buildActivityStatus({ inferenceStatus: 'generating', inferenceActive: true }).busy, true);
});

test('request activity tracking ignores health checks and passive polling', () => {
  const passiveRequests = [
    ['GET', '/'],
    ['GET', '/healthz'],
    ['GET', '/activity/status'],
    ['GET', '/train/current'],
    ['GET', '/inference/current'],
    ['GET', '/inference/status'],
    ['GET', '/models'],
    ['GET', '/train/progress/abc'],
    ['GET', '/inference/progress/abc'],
    ['POST', '/train'],
    ['POST', '/train/stop'],
    ['POST', '/inference'],
    ['POST', '/inference/generate'],
    ['POST', '/inference/cancel'],
    ['POST', '/inference/start'],
    ['POST', '/inference/stop'],
    ['POST', '/inference/tts'],
    ['POST', '/inference/weights/gpt'],
    ['POST', '/inference/weights/sovits'],
    ['POST', '/models/download'],
    ['POST', '/ref-audio/download'],
    ['POST', '/transcribe'],
    ['GET', '/training-audio/demo'],
    ['GET', '/training-audio/file/demo/sample.wav'],
    ['GET', '/inference/result/session-123'],
    ['GET', '/ref-audio'],
  ];

  for (const [method, path] of passiveRequests) {
    assert.equal(shouldTrackRequestActivity({ method, path }), false, `${method} ${path}`);
  }
});

test('actual training or inference work refreshes the activity timestamp', () => {
  const state = {
    lastActivityAt: 1_000,
    mark(now) {
      this.lastActivityAt = now;
    },
    getLastActivityAt() {
      return this.lastActivityAt;
    },
  };

  assert.equal(refreshActivityWhileBusy({
    state,
    trainingActive: true,
    now: 9_000,
  }), 9_000);

  state.lastActivityAt = 2_000;

  assert.equal(refreshActivityWhileBusy({
    state,
    inferenceActive: true,
    now: 10_000,
  }), 10_000);
});

test('stuck busy status without active work does not refresh activity timestamp', () => {
  const state = {
    lastActivityAt: 1_000,
    mark(now) {
      this.lastActivityAt = now;
    },
    getLastActivityAt() {
      return this.lastActivityAt;
    },
  };

  assert.equal(refreshActivityWhileBusy({
    state,
    trainingStatus: 'running',
    inferenceStatus: 'generating',
    trainingActive: false,
    inferenceActive: false,
    now: 9_000,
  }), 1_000);
});

test('stuck busy status without active work reports not busy for idle shutdown', () => {
  const status = buildActivityStatus({
    lastActivityAt: 1_000,
    now: 9_000,
    trainingStatus: 'running',
    inferenceStatus: 'idle',
    trainingActive: false,
    inferenceActive: false,
  });

  assert.equal(status.busy, false);
  assert.equal(status.trainingStatus, 'running');
  assert.equal(status.idleMs, 8_000);
});
