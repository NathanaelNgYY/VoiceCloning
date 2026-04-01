import { STEPS } from './trainingSteps.js';

const MAX_LOGS = 2000;

function createSteps() {
  return STEPS.map((name, index) => ({ index, name, status: 'pending', detail: '' }));
}

class TrainingState {
  constructor() {
    this.state = this.getInitialState();
  }

  getInitialState() {
    return {
      sessionId: null,
      expName: '',
      status: 'idle', // idle | waiting | running | complete | error | stopped
      startedAt: null,
      endedAt: null,
      logs: [],
      steps: createSteps(),
      error: null,
    };
  }

  resetForNewSession({ sessionId, expName }) {
    this.state = {
      ...this.getInitialState(),
      sessionId,
      expName,
      status: 'waiting',
      startedAt: Date.now(),
    };
  }

  clear() {
    this.state = this.getInitialState();
  }

  appendLog(log) {
    this.state.logs.push(log);
    if (this.state.logs.length > MAX_LOGS) {
      this.state.logs = this.state.logs.slice(-MAX_LOGS);
    }
  }

  setStatus(status) {
    this.state.status = status;
    if (['complete', 'error', 'stopped'].includes(status)) {
      this.state.endedAt = Date.now();
    }
  }

  setStepStatus(stepIndex, status, detail = '') {
    this.state.steps = this.state.steps.map((step) =>
      step.index === stepIndex ? { ...step, status, detail } : step
    );
  }

  setError(message) {
    this.state.error = message;
    this.state.status = 'error';
    this.state.endedAt = Date.now();
  }

  getState() {
    return {
      ...this.state,
      logs: [...this.state.logs],
      steps: this.state.steps.map((step) => ({ ...step })),
    };
  }
}

export const trainingState = new TrainingState();
