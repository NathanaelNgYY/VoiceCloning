class CoordinatorState {
  constructor() {
    this.draining = false;
    this.modelKey = '';
    this.voiceProfileId = '';
    this.updatedAt = 0;
  }

  beginDrain() {
    if (this.draining) return false;
    this.draining = true;
    return true;
  }

  finishDrain() {
    this.draining = false;
  }

  assign({ modelKey = '', voiceProfileId = '', now = Date.now() } = {}) {
    this.modelKey = String(modelKey || '').trim();
    this.voiceProfileId = String(voiceProfileId || '').trim();
    this.updatedAt = now;
  }

  snapshot() {
    return {
      draining: this.draining,
      modelKey: this.modelKey || null,
      voiceProfileId: this.voiceProfileId || null,
      updatedAt: this.updatedAt || null,
    };
  }
}

export const coordinatorState = new CoordinatorState();
