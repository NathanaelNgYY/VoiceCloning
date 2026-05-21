import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
  GEMINI_API_KEY,
  GEMINI_LIVE_MODEL,
  OPENAI_REALTIME_SYSTEM_PROMPT,
} from '../config.js';
import { GeminiLiveEventMapper, buildGeminiSetup } from './geminiLiveEvents.js';

const GEMINI_LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';

// Client sends 24kHz PCM16; Gemini Live accepts 16kHz PCM16.
const CLIENT_SAMPLE_RATE = 24000;
const GEMINI_SAMPLE_RATE = 16000;

function downsampleInt16(input, fromRate, toRate) {
  const ratio = fromRate / toRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcF = i * ratio;
    const src = Math.floor(srcF);
    const frac = srcF - src;
    const s1 = input[src] ?? 0;
    const s2 = input[Math.min(src + 1, input.length - 1)] ?? 0;
    output[i] = Math.round(s1 + (s2 - s1) * frac);
  }
  return output;
}

function resampleBase64Pcm16(base64, fromRate, toRate) {
  if (fromRate === toRate) return base64;
  const buf = Buffer.from(base64, 'base64');
  const int16In = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const int16Out = downsampleInt16(int16In, fromRate, toRate);
  return Buffer.from(int16Out.buffer, int16Out.byteOffset, int16Out.byteLength).toString('base64');
}

function buildGeminiUrl(apiKey) {
  return `${GEMINI_LIVE_URL}?key=${encodeURIComponent(apiKey)}`;
}

function safeErrorEvent(message, code = 'gemini_live_error') {
  return { type: 'error', message, code };
}

export class GeminiLiveBridge extends EventEmitter {
  constructor({
    apiKey = GEMINI_API_KEY,
    model = GEMINI_LIVE_MODEL,
    systemPrompt = OPENAI_REALTIME_SYSTEM_PROMPT,
    language = 'en',
    WebSocketClass = WebSocket,
  } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.language = language;
    this.WebSocketClass = WebSocketClass;
    this.socket = null;
    this.mapper = new GeminiLiveEventMapper({ language });
    this.closed = false;
    this.inputPaused = false;
    this.hasPendingAudio = false;
  }

  connect() {
    if (!this.apiKey) {
      this.emit('app-event', safeErrorEvent(
        'Gemini Live is not configured. Set GEMINI_API_KEY on the backend.',
        'gemini_live_missing_config',
      ));
      this.handleClose();
      return;
    }

    this.closed = false;
    this.socket = new this.WebSocketClass(buildGeminiUrl(this.apiKey));
    const socket = this.socket;

    socket.on('open', () => {
      if (socket !== this.socket) return;
      console.log('[geminiLive] WebSocket connected, sending setup...');
      const setup = buildGeminiSetup({
        model: this.model,
        systemPrompt: this.systemPrompt,
        language: this.language,
      });
      console.log('[geminiLive] Setup:', JSON.stringify(setup));
      this.sendGemini(setup);
    });

    socket.on('message', (data) => {
      if (socket !== this.socket) return;
      this.handleMessage(data);
    });

    socket.on('error', (err) => {
      if (socket !== this.socket) return;
      console.error('[geminiLive] Socket error:', err?.message || err);
      this.emit('app-event', safeErrorEvent(
        'AI conversation failed while connecting to Gemini Live.',
        'gemini_live_socket_error',
      ));
    });

    socket.on('close', (code, reason) => {
      console.log('[geminiLive] Socket closed:', code, reason?.toString());
      this.handleClose(socket);
    });
  }

  handleMessage(data) {
    let event;
    const raw = data.toString();
    try {
      event = JSON.parse(raw);
    } catch {
      console.error('[geminiLive] Failed to parse message:', raw.slice(0, 200));
      this.emit('app-event', safeErrorEvent(
        'AI conversation failed: received an unreadable event.',
        'gemini_live_parse_error',
      ));
      return;
    }

    console.log('[geminiLive] Received:', JSON.stringify(event).slice(0, 300));
    for (const appEvent of this.mapper.map(event)) {
      this.emit('app-event', { type: appEvent.type, ...appEvent });
    }
  }

  handleClose(socket = this.socket) {
    if (socket && socket !== this.socket) return;
    if (this.closed) return;
    this.closed = true;
    this.socket = null;
    this.emit('app-event', { type: 'session.closed' });
    this.emit('close');
  }

  sendAudio(base64Audio) {
    if (this.closed || this.inputPaused || !base64Audio) return false;

    const resampled = resampleBase64Pcm16(base64Audio, CLIENT_SAMPLE_RATE, GEMINI_SAMPLE_RATE);
    const sent = this.sendGemini({
      realtimeInput: {
        mediaChunks: [{ data: resampled, mimeType: 'audio/pcm;rate=16000' }],
      },
    });

    if (sent) this.hasPendingAudio = true;
    return sent;
  }

  pauseInput() {
    this.inputPaused = true;
    this.hasPendingAudio = false;
    return true;
  }

  resumeInput() {
    this.inputPaused = false;
    return true;
  }

  commitInput() {
    if (this.closed || this.inputPaused || !this.hasPendingAudio) return false;
    this.inputPaused = true;
    this.hasPendingAudio = false;
    this.sendGemini({ clientContent: { turnComplete: true } });
    return true;
  }

  cancelResponse() {
    this.inputPaused = true;
    return true;
  }

  close() {
    if (!this.socket) {
      this.handleClose();
      return;
    }

    if (
      this.socket.readyState === this.WebSocketClass.CONNECTING
      || this.socket.readyState === this.WebSocketClass.OPEN
    ) {
      this.socket.close(1000, 'Live session ended');
      return;
    }

    this.handleClose();
  }

  sendGemini(message) {
    if (!this.socket || this.socket.readyState !== this.WebSocketClass.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }
}
