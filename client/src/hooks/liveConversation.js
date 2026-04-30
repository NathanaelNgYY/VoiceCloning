export const LIVE_TEXT_LANG = 'en';
export const LIVE_REPLY_MODES = {
  full: 'full',
  phrases: 'phrases',
};

const QUESTION_START_RE =
  /^(who|what|where|when|why|how|which|whose|can|could|should|would|will|do|does|did|is|are|am|was|were|have|has|had)\b/i;

export function cleanLiveText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function isLiveInputPhase(phase) {
  return phase === 'listening' || phase === 'thinking';
}

export function shouldSendLiveMicAudio({ phase, micInputEnabled }) {
  return Boolean(micInputEnabled) && isLiveInputPhase(phase);
}

export function getMicOffAction({ phase, hasPendingAudio }) {
  if (phase === 'listening' && hasPendingAudio) {
    return 'commit';
  }

  if (phase === 'listening' || phase === 'speaking') {
    return 'pause';
  }

  return 'wait';
}

function ensurePhraseEnding(text) {
  if (/[.!?;:]$/.test(text)) return text;
  return `${text}${QUESTION_START_RE.test(text) ? '?' : '.'}`;
}

export function splitLiveReplyPhrases(text) {
  const clean = cleanLiveText(text);
  if (!clean) return [];

  const matches = clean.match(/[^.!?;:]+[.!?;:]+|[^.!?;:]+$/g) || [clean];
  return matches
    .map((part) => ensurePhraseEnding(part.trim()))
    .filter(Boolean);
}

export function buildLiveReplyParams(text, refParams = {}) {
  return {
    text: cleanLiveText(text),
    text_lang: LIVE_TEXT_LANG,
    ref_audio_path: refParams.ref_audio_path,
    prompt_text: refParams.prompt_text || '',
    prompt_lang: refParams.prompt_lang || 'en',
    aux_ref_audio_paths: refParams.aux_ref_audio_paths || [],
  };
}

export function buildLiveSentenceParams(text, refParams = {}) {
  return buildLiveReplyParams(text, refParams);
}

export function createChatMessage({
  id,
  role,
  text = '',
  status = 'done',
  itemId = '',
  audioUrl = null,
  audioParts = [],
  error = null,
  createdAt = Date.now(),
}) {
  return {
    id,
    role,
    text,
    status,
    itemId,
    audioUrl,
    audioParts,
    error,
    createdAt,
  };
}

export function updateMessage(messages, id, patch) {
  return messages.map((message) =>
    message.id === id ? { ...message, ...patch } : message
  );
}

export function findSelectedPlayback(messages, selectedId) {
  if (!selectedId) return null;

  for (const message of messages) {
    if (message.id === selectedId && message.audioUrl) {
      return { message, part: null, audioUrl: message.audioUrl };
    }

    const part = (message.audioParts || []).find((item) => item.id === selectedId);
    if (part?.audioUrl) {
      return { message, part, audioUrl: part.audioUrl };
    }
  }

  return null;
}

export function findNextPhrasePlayback(messages, selectedId) {
  if (!selectedId) return null;

  for (const message of messages) {
    const parts = message.audioParts || [];
    const currentIndex = parts.findIndex((part) => part.id === selectedId);
    if (currentIndex === -1) continue;

    const nextPart = parts
      .slice(currentIndex + 1)
      .find((part) => part.audioUrl && part.status === 'ready');

    return nextPart ? { message, part: nextPart, audioUrl: nextPart.audioUrl } : null;
  }

  return null;
}
