const DEFAULT_SYSTEM_PROMPT =
  'You are a casual, helpful assistant. Keep replies concise and conversational.';

function cleanText(value) {
  return String(value || '').trim();
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
} = {}) {
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
      instructions: systemPrompt || DEFAULT_SYSTEM_PROMPT,
      output_modalities: ['text'],
      audio: {
        input: {
          format: {
            type: 'audio/pcm',
            rate: 24000,
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
  constructor() {
    this.buffers = new Map();
    this.completed = new Set();
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
        return [this.mapError(event)];

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

  mapTextDone(event) {
    const key = textPartKey(event);
    if (this.completed.has(key)) {
      return [];
    }

    const text = cleanText(event.text || this.buffers.get(key) || '');
    this.completed.add(key);
    this.buffers.delete(key);

    return text ? [{ type: 'assistant.text.done', text }] : [];
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

    return text ? [{ type: 'assistant.text.done', text }] : [];
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
