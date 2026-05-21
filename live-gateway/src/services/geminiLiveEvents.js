import { preprocessText } from './textPreprocessor.js';

const DEFAULT_SYSTEM_PROMPT =
  'You are a casual, helpful assistant. Keep replies concise and conversational. Use commas to create natural rhythm in longer sentences, and em dashes — like this — for mid-sentence pauses. Use question marks on genuine questions.';

export function buildGeminiSetup({ model, systemPrompt = DEFAULT_SYSTEM_PROMPT, language = 'en' }) {
  const languageInstruction = language === 'zh'
    ? ' Always respond only in Chinese. Use Simplified Chinese characters. Do not include English words, Latin letters, pinyin, or English number words; write numbers as Arabic numerals or Chinese characters.'
    : ' Always respond only in English.';

  const modelId = model.startsWith('models/') ? model : `models/${model}`;

  return {
    setup: {
      model: modelId,
      generationConfig: {
        responseModalities: ['TEXT'],
        inputAudioTranscription: {},
      },
      systemInstruction: {
        parts: [{ text: `${systemPrompt}${languageInstruction}` }],
      },
    },
  };
}

export class GeminiLiveEventMapper {
  constructor({ language = 'en' } = {}) {
    this.language = language;
    this.textBuffer = '';
    this.inTurn = false;
  }

  preprocessAssistantText(text) {
    return this.language === 'zh' ? text : preprocessText(text);
  }

  map(event) {
    if (!event || typeof event !== 'object') return [];

    if (event.setupComplete !== undefined) {
      return [{ type: 'session.ready' }];
    }

    if (event.serverContent) {
      return this.mapServerContent(event.serverContent);
    }

    if (event.error) {
      const msg = event.error.message || 'Unknown Gemini error';
      return [{
        type: 'error',
        message: `AI conversation failed: ${msg}`,
        code: String(event.error.code || 'gemini_error'),
      }];
    }

    return [];
  }

  mapServerContent(content) {
    const events = [];

    // User speech transcription (when inputAudioTranscription is enabled)
    if (content.inputTranscript?.text) {
      events.push({
        type: 'user.text.done',
        itemId: '',
        text: content.inputTranscript.text.trim(),
      });
    }

    if (content.modelTurn?.parts?.length) {
      if (!this.inTurn) {
        this.inTurn = true;
        // Approximate user.speech.stopped so the UI transitions to 'thinking'
        if (!content.inputTranscript) {
          events.push({ type: 'user.speech.stopped' });
        }
        events.push({ type: 'assistant.thinking' });
      }

      for (const part of content.modelTurn.parts) {
        if (typeof part.text === 'string' && part.text) {
          this.textBuffer += part.text;
          events.push({ type: 'assistant.text.delta', text: part.text });
        }
      }
    }

    if (content.turnComplete) {
      this.inTurn = false;
      const text = this.textBuffer.trim();
      this.textBuffer = '';
      if (text) {
        events.push({ type: 'assistant.text.done', text: this.preprocessAssistantText(text) });
      }
    }

    return events;
  }
}
