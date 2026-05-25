// NOTE: This file is retained for reference but is currently unused.
// The live-chat route has been switched to always use OpenAiRealtimeBridge.
import { EventEmitter } from 'events';
import {
  GEMINI_API_KEY,
  GEMINI_LIVE_MODEL,
  OPENAI_REALTIME_SYSTEM_PROMPT,
} from '../config.js';
import { preprocessText } from './textPreprocessor.js';

const GEMINI_REST_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const SILENCE_COMMIT_MS = 1200;
const PCM_SAMPLE_RATE = 24000;
const SPEECH_RMS_THRESHOLD = 0.008; // below this = silence, don't reset timer

function buildWavBuffer(pcmBuffer, sampleRate = PCM_SAMPLE_RATE) {
  const header = Buffer.alloc(44);
  const dataLen = pcmBuffer.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);  // PCM
  header.writeUInt16LE(1, 22);  // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcmBuffer]);
}

function rmsOfPcm16Base64(base64) {
  const buf = Buffer.from(base64, 'base64');
  const samples = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] / 32768;
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / samples.length);
}

function chunksToWavBase64(base64Chunks) {
  const pcm = Buffer.concat(base64Chunks.map((b) => Buffer.from(b, 'base64')));
  return buildWavBuffer(pcm).toString('base64');
}

function buildSystemPrompt(base, language) {
  const lang = language === 'zh'
    ? ' Always respond only in Chinese. Use Simplified Chinese characters.'
    : ' Always respond only in English.';
  return `${base}${lang}`;
}

async function callGeminiRest({ apiKey, model, systemPrompt, audioWavBase64, history }) {
  const url = `${GEMINI_REST_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const historyContents = history.map(({ role, text }) => ({
    role: role === 'assistant' ? 'model' : 'user',
    parts: [{ text }],
  }));

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      ...historyContents,
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'audio/wav', data: audioWavBase64 } },
          { text: 'Respond to what was said. Return ONLY a JSON object: {"transcript": "exact words spoken", "reply": "your response"}' },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json' },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

  try {
    const parsed = JSON.parse(text);
    return {
      userText: (parsed.transcript || '').trim(),
      assistantText: (parsed.reply || parsed.response || '').trim(),
    };
  } catch {
    return { userText: '', assistantText: text };
  }
}

export class GeminiRestBridge extends EventEmitter {
  constructor({
    apiKey = GEMINI_API_KEY,
    model = GEMINI_LIVE_MODEL,
    systemPrompt = OPENAI_REALTIME_SYSTEM_PROMPT,
    language = 'en',
  } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.language = language;
    this.audioChunks = [];
    this.hasPendingAudio = false;
    this.inputPaused = false;
    this.closed = false;
    this.processing = false;
    this.conversationHistory = [];
    this.silenceTimer = null;
  }

  connect() {
    if (!this.apiKey) {
      this.emit('app-event', {
        type: 'error',
        message: 'Gemini API key not configured. Set GEMINI_API_KEY on the backend.',
        code: 'gemini_missing_config',
      });
      this.handleClose();
      return;
    }
    console.log('[geminiRest] Ready, model:', this.model);
    process.nextTick(() => {
      if (!this.closed) this.emit('app-event', { type: 'session.ready' });
    });
  }

  sendAudio(base64Audio) {
    if (this.closed || this.inputPaused || this.processing || !base64Audio) return false;
    this.audioChunks.push(base64Audio);
    // Only treat as speech (and reset silence timer) if loud enough
    const rms = rmsOfPcm16Base64(base64Audio);
    if (rms > SPEECH_RMS_THRESHOLD) {
      if (!this.hasPendingAudio) console.log('[geminiRest] Speech detected, accumulating...');
      this.hasPendingAudio = true;
      this._resetSilenceTimer();
    }
    return true;
  }

  _resetSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (this.hasPendingAudio && !this.inputPaused && !this.processing && !this.closed) {
        this._processAudio();
      }
    }, SILENCE_COMMIT_MS);
  }

  pauseInput() {
    this.inputPaused = true;
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    return true;
  }

  resumeInput() {
    this.inputPaused = false;
    return true;
  }

  commitInput() {
    if (this.closed || this.processing || !this.hasPendingAudio) return false;
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    this._processAudio();
    return true;
  }

  cancelResponse() {
    this.inputPaused = true;
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    return true;
  }

  async _processAudio() {
    if (this.processing || this.closed || !this.hasPendingAudio) return;

    const chunks = [...this.audioChunks];
    this.audioChunks = [];
    this.hasPendingAudio = false;
    this.inputPaused = true;
    this.processing = true;

    this.emit('app-event', { type: 'user.speech.stopped' });
    this.emit('app-event', { type: 'assistant.thinking' });

    try {
      console.log('[geminiRest] Calling Gemini with', chunks.length, 'audio chunks');
      const wavBase64 = chunksToWavBase64(chunks);
      const { userText, assistantText } = await callGeminiRest({
        apiKey: this.apiKey,
        model: this.model,
        systemPrompt: buildSystemPrompt(this.systemPrompt, this.language),
        audioWavBase64: wavBase64,
        history: this.conversationHistory,
      });

      if (this.closed) return;
      console.log('[geminiRest] transcript:', userText, '| reply:', assistantText?.slice(0, 80));

      if (userText) {
        this.emit('app-event', { type: 'user.text.done', itemId: '', text: userText });
      }

      if (assistantText) {
        this.conversationHistory.push(
          { role: 'user', text: userText || '[voice]' },
          { role: 'assistant', text: assistantText },
        );
        if (this.conversationHistory.length > 20) {
          this.conversationHistory = this.conversationHistory.slice(-20);
        }
        const processed = this.language === 'zh' ? assistantText : preprocessText(assistantText);
        this.emit('app-event', { type: 'assistant.text.done', text: processed });
      }
    } catch (err) {
      console.error('[geminiRest] Error:', err.message);
      if (!this.closed) {
        this.emit('app-event', {
          type: 'error',
          message: `AI response failed: ${err.message}`,
          code: 'gemini_rest_error',
        });
      }
    } finally {
      this.processing = false;
      if (!this.closed) this.inputPaused = false;
    }
  }

  handleClose() {
    if (this.closed) return;
    this.closed = true;
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    this.emit('app-event', { type: 'session.closed' });
    this.emit('close');
  }

  close() {
    this.handleClose();
  }
}
