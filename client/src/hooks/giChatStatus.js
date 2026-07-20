// Adapters between the live-speech engine's vocabulary and the vocabulary the
// ported gi-bleeding components expect. Kept separate from useGiChatEngine so
// they can be unit-tested without mounting React.

const PHASE_TO_STATUS = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  generating_voice: 'thinking',
  speaking: 'speaking',
};

const BUSY_PHASES = new Set(['thinking', 'generating_voice', 'speaking']);

export function toGiStatus(phase, { hasError = false } = {}) {
  const status = PHASE_TO_STATUS[phase] || 'idle';
  return hasError && status === 'idle' ? 'error' : status;
}

export function isResponseBusy(phase) {
  return BUSY_PHASES.has(phase);
}

export function isVoiceActive(phase) {
  return Boolean(phase) && phase !== 'idle';
}
