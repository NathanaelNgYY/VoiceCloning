import { preprocessText } from './textPreprocessor.js';

const REALTIME_LANGUAGES = {
  en: { code: 'en', name: 'English' },
  zh: { code: 'zh', name: 'Chinese' },
};
const LANGUAGE_INSTRUCTION_RE =
  /\b(?:always\s+)?respond\s+only\s+in\s+(?:english|chinese)\.?\s*/gi;
const LANGUAGE_ONLY_RE = /\b(?:english|chinese)\s+only\.?\s*/gi;

const DEFAULT_SYSTEM_PROMPT =
  'You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English. Use commas to create natural rhythm in longer sentences, and em dashes — like this — for mid-sentence pauses. Use question marks on genuine questions.';

function cleanText(value) {
  return String(value || '').trim();
}

export function normalizeRealtimeLanguage(language) {
  return language === REALTIME_LANGUAGES.zh.code
    ? REALTIME_LANGUAGES.zh.code
    : REALTIME_LANGUAGES.en.code;
}

function languageOnlyPrompt(systemPrompt, language) {
  const languageConfig = REALTIME_LANGUAGES[normalizeRealtimeLanguage(language)];
  const languageInstruction = languageConfig.code === REALTIME_LANGUAGES.zh.code
    ? 'Always respond only in Chinese. Use Simplified Chinese characters. Do not include English words, Latin letters, pinyin, or English number words; write numbers as Arabic numerals or Chinese characters.'
    : `Always respond only in ${languageConfig.name}.`;
  const prompt = cleanText(systemPrompt) || DEFAULT_SYSTEM_PROMPT;
  const neutralPrompt = cleanText(
    prompt
      .replace(LANGUAGE_INSTRUCTION_RE, '')
      .replace(LANGUAGE_ONLY_RE, '')
      .replace(/\s+/g, ' ')
  );
  const basePrompt = neutralPrompt || 'You are a casual, helpful assistant. Keep replies concise and conversational.';
  return `${basePrompt} ${languageInstruction}`;
}

function responseKey(event) {
  return event.response_id || event.item_id || event.event_id || 'default';
}

function hasKeyPart(value) {
  return value !== undefined && value !== null && value !== '';
}

function textPartKey(event) {
  if (
    hasKeyPart(event.response_id)
    && hasKeyPart(event.item_id)
    && hasKeyPart(event.content_index)
  ) {
    return [
      event.response_id,
      event.item_id,
      event.content_index,
    ].join(':');
  }

  return responseKey(event);
}

export function getMissingOpenAiConfigMessage(apiKey) {
  return apiKey
    ? ''
    : 'OpenAI Realtime is not configured. Set OPENAI_API_KEY on the backend.';
}

export function buildClientEvent(type, payload = {}) {
  return { type, ...payload };
}

export function buildRealtimeSessionUpdate({
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
  vadMode = 'semantic_vad',
  language = REALTIME_LANGUAGES.en.code,
} = {}) {
  const languageCode = normalizeRealtimeLanguage(language);
  const turnDetection = vadMode === 'server_vad'
    ? {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 650,
        create_response: true,
        interrupt_response: true,
      }
    : {
        type: 'semantic_vad',
        eagerness: 'auto',
        create_response: true,
        interrupt_response: true,
      };

  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: languageOnlyPrompt(systemPrompt, languageCode),
      output_modalities: ['text'],
      audio: {
        input: {
          format: {
            type: 'audio/pcm',
            rate: 24000,
          },
          transcription: {
            model: 'gpt-4o-mini-transcribe',
            language: languageCode,
          },
          noise_reduction: {
            type: 'near_field',
          },
          turn_detection: turnDetection,
        },
      },
    },
  };
}

export class RealtimeEventMapper {
  constructor({ language = REALTIME_LANGUAGES.en.code } = {}) {
    this.language = normalizeRealtimeLanguage(language);
    this.buffers = new Map();
    this.completed = new Set();
  }

  preprocessAssistantText(text) {
    return this.language === REALTIME_LANGUAGES.zh.code
      ? text
      : preprocessText(text);
  }

  map(event) {
    if (!event || typeof event !== 'object') {
      return [];
    }

    switch (event.type) {
      case 'session.updated':
        return [{ type: 'session.ready' }];

      case 'input_audio_buffer.speech_started':
        return [{ type: 'user.speech.started' }];

      case 'input_audio_buffer.speech_stopped':
        return [{ type: 'user.speech.stopped' }];

      case 'conversation.item.input_audio_transcription.delta':
        return this.mapUserTextDelta(event);

      case 'conversation.item.input_audio_transcription.completed':
        return this.mapUserTextDone(event);

      case 'conversation.item.input_audio_transcription.failed':
        return [{
          type: 'user.text.failed',
          itemId: event.item_id || '',
          message: cleanText(event.error?.message || 'User speech transcription failed.'),
        }];

      case 'response.created':
        return [{ type: 'assistant.thinking' }];

      case 'response.output_text.delta':
      case 'response.text.delta':
        return this.mapTextDelta(event);

      case 'response.output_text.done':
      case 'response.text.done':
        return this.mapTextDone(event);

      case 'response.done':
        return this.mapResponseDone(event);

      case 'error':
        return this.mapErrorEvent(event);

      default:
        return [];
    }
  }

  mapTextDelta(event) {
    const delta = String(event.delta || '');
    if (!delta) {
      return [];
    }

    const key = textPartKey(event);
    const current = this.buffers.get(key) || '';
    this.buffers.set(key, `${current}${delta}`);
    return [{ type: 'assistant.text.delta', text: delta }];
  }

  mapUserTextDelta(event) {
    const text = String(event.delta || '');
    return text ? [{
      type: 'user.text.delta',
      itemId: event.item_id || '',
      text,
    }] : [];
  }

  mapUserTextDone(event) {
    const text = cleanText(event.transcript || event.text || '');
    return text ? [{
      type: 'user.text.done',
      itemId: event.item_id || '',
      text,
    }] : [];
  }

  mapTextDone(event) {
    const key = textPartKey(event);
    if (this.completed.has(key)) {
      return [];
    }

    const text = cleanText(event.text || this.buffers.get(key) || '');
    this.completed.add(key);
    this.buffers.delete(key);

    return text ? [{ type: 'assistant.text.done', text: this.preprocessAssistantText(text) }] : [];
  }

  mapResponseDone(event) {
    const response = event.response;
    const key = response?.id || responseKey(event);
    if (this.completed.has(key)) {
      return [];
    }

    const output = Array.isArray(response?.output) ? response.output : [];
    const textParts = [];
    for (const item of output) {
      const content = Array.isArray(item.content) ? item.content : [];
      for (const [contentIndex, part] of content.entries()) {
        if (part.type === 'output_text' && part.text) {
          const partKey = textPartKey({
            response_id: response?.id,
            item_id: item.id,
            content_index: contentIndex,
          });

          if (!this.completed.has(partKey)) {
            textParts.push({ key: partKey, text: part.text });
          }
        }
      }
    }

    const text = cleanText(textParts.map((part) => part.text).join(' ') || this.buffers.get(key) || '');
    this.completed.add(key);
    for (const part of textParts) {
      this.completed.add(part.key);
      this.buffers.delete(part.key);
    }
    this.buffers.delete(key);

    return text ? [{ type: 'assistant.text.done', text: this.preprocessAssistantText(text) }] : [];
  }

  mapErrorEvent(event) {
    const message = cleanText(event.error?.message || event.message || '');
    // Transient audio buffer errors — the session self-recovers, no need to surface these.
    if (/buffer too small|audio buffer/i.test(message)) return [];
    return [this.mapError(event)];
  }

  mapError(event) {
    const message = cleanText(event.error?.message || event.message || 'OpenAI Realtime error');
    return {
      type: 'error',
      message: `AI conversation failed: ${message}`,
      code: event.error?.code || event.code || 'openai_realtime_error',
    };
  }
}
