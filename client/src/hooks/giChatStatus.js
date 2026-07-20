// Adapters between the live-speech engine's vocabulary and the vocabulary the
// ported gi-bleeding components expect. Kept separate from useGiChatEngine so
// they can be unit-tested without mounting React.

const PHASE_TO_STATUS = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  generating_voice: 'thinking',
  speaking: 'speaking',
  // useLiveSpeech.js:1318 sets this while start() is requesting the mic and
  // opening the live-chat socket, before the first 'listening' phase.
  connecting: 'connecting',
  // useLiveSpeech.js:1371 sets this synchronously inside stop(), immediately
  // followed by setPhase('idle') in the same call — React's automatic
  // batching means this never renders as its own frame today, but the phase
  // is genuinely emitted, so it gets an explicit (not fallback) mapping.
  stopping: 'idle',
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
