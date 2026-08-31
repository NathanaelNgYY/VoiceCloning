const BLOCKING_STATES = new Set(['CHECKING', 'STARTING', 'WARMING', 'LIMIT', 'ERROR']);

export function normalizeVoiceCapacity(value = {}) {
  const state = String(value?.state || 'CHECKING').trim().toUpperCase();
  return {
    state,
    canStartConversation: value?.canStartConversation === true,
    availableSlots: Math.max(0, Number(value?.availableSlots) || 0),
    capacityTight: value?.capacityTight === true,
    retryAfterSeconds: Math.max(0, Number(value?.retryAfterSeconds) || 0),
    capacityAction: String(value?.capacityAction || 'none').trim().toLowerCase(),
    simulated: value?.simulated === true,
    message: String(value?.message || '').trim(),
  };
}

export function voiceCapacityBlocksConversation(capacity = {}) {
  const normalized = normalizeVoiceCapacity(capacity);
  return BLOCKING_STATES.has(normalized.state) && !normalized.canStartConversation;
}

export function voiceCapacityNotice(capacity = {}) {
  const value = normalizeVoiceCapacity(capacity);
  if (value.simulated || value.state === 'SIMULATED') {
    return value.message || 'Dev capacity simulation: staging would prepare more capacity, but Dev autoscaling is disabled.';
  }
  if (value.state === 'ON_DEMAND') {
    return value.message || 'This voice will load on the first synthesis request. Selecting it did not start another GPU.';
  }
  if (value.state === 'CHECKING') return 'Checking this lecture voice capacity…';
  if (value.state === 'STARTING') {
    return 'This lecture voice is not active yet. A GPU is starting; allow up to 15 minutes, or try another lecture meanwhile.';
  }
  if (value.state === 'WARMING') {
    return 'A genuinely idle GPU is switching to this lecture voice. Voice conversation will unlock when warming finishes.';
  }
  if (value.state === 'BUSY_STARTING') {
    return 'This lecture voice is busy. You can continue; another GPU is starting in the background, so voice audio may be delayed.';
  }
  if (value.state === 'BUSY_WARMING') {
    return 'This lecture voice is busy. You can continue while a genuinely idle GPU switches to add capacity.';
  }
  if (value.state === 'BUSY_LIMIT') {
    return 'This lecture voice is busy and staging is at its GPU limit. You can continue, but voice audio may be delayed.';
  }
  if (value.state === 'LIMIT') {
    return 'This lecture voice is unavailable because staging is at its GPU limit. Please try another lecture.';
  }
  if (value.state === 'READY_SCALING') {
    return 'This lecture voice is available and another GPU is starting in the background to add capacity.';
  }
  if (value.state === 'READY_WARMING') {
    return 'This lecture voice is available while a genuinely idle GPU switches in the background to add capacity.';
  }
  if (value.state === 'ERROR') return 'Voice capacity could not be verified. Please retry before starting a conversation.';
  if (value.capacityTight) {
    return 'This lecture voice is available, but only one slot remains. If your request fills it, extra capacity will be prepared in the background.';
  }
  return '';
}
