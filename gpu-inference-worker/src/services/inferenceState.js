import { activityState } from './activityState.js';

class InferenceState {
  constructor() {
    this.state = this.getInitialState();
  }

  getInitialState() {
    return {
      sessionId: null,
      status: 'idle', // idle | waiting | generating | complete | error | cancelled
      startedAt: null,
      endedAt: null,
      totalChunks: 0,
      completedChunks: 0,
      currentChunkText: '',
      error: null,
      resultReady: false,
      params: null,
    };
  }

  resetForNewSession({ sessionId, params }) {
    activityState.mark();
    this.state = {
      ...this.getInitialState(),
      sessionId,
      status: 'waiting',
      startedAt: Date.now(),
      params: params ? { ...params } : null,
    };
  }

  setGenerating({ totalChunks = 0 } = {}) {
    activityState.mark();
    this.state.status = 'generating';
    this.state.totalChunks = totalChunks;
    this.state.error = null;
  }

  setChunkStart({ index, text, totalChunks }) {
    activityState.mark();
    this.state.status = 'generating';
    this.state.currentChunkText = text || '';
    if (typeof totalChunks === 'number') {
      this.state.totalChunks = totalChunks;
    }
    if (typeof index === 'number') {
      this.state.completedChunks = Math.min(this.state.completedChunks, index);
    }
  }

  setChunkComplete({ index, totalChunks }) {
    activityState.mark();
    this.state.status = 'generating';
    this.state.currentChunkText = '';
    this.state.completedChunks = typeof index === 'number'
      ? index + 1
      : this.state.completedChunks;
    if (typeof totalChunks === 'number') {
      this.state.totalChunks = totalChunks;
    }
  }

  setComplete() {
    activityState.mark();
    this.state.status = 'complete';
    this.state.currentChunkText = '';
    this.state.error = null;
    this.state.resultReady = true;
    this.state.endedAt = Date.now();
  }

  setError(message, status = 'error') {
    activityState.mark();
    this.state.status = status;
    this.state.currentChunkText = '';
    this.state.error = message || null;
    this.state.resultReady = false;
    this.state.endedAt = Date.now();
  }

  getState() {
    return {
      ...this.state,
      params: this.state.params ? { ...this.state.params } : null,
    };
  }
}

export const inferenceState = new InferenceState();
