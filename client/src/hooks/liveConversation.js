export const LIVE_TEXT_LANG = 'en';

export function cleanLiveText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function buildLiveReplyParams(text, refParams = {}) {
  return {
    text: cleanLiveText(text),
    text_lang: LIVE_TEXT_LANG,
    ref_audio_path: refParams.ref_audio_path,
    prompt_text: refParams.prompt_text || '',
    prompt_lang: refParams.prompt_lang || 'en',
  };
}

export function createChatMessage({
  id,
  role,
  text = '',
  status = 'done',
  itemId = '',
  audioUrl = null,
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
    error,
    createdAt,
  };
}

export function updateMessage(messages, id, patch) {
  return messages.map((message) =>
    message.id === id ? { ...message, ...patch } : message
  );
}
