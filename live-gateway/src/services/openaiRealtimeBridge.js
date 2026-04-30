import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
  OPENAI_API_KEY,
  OPENAI_REALTIME_MODEL,
  OPENAI_REALTIME_SYSTEM_PROMPT,
  OPENAI_REALTIME_VAD,
} from '../config.js';
import {
  RealtimeEventMapper,
  buildClientEvent,
  buildRealtimeSessionUpdate,
  getMissingOpenAiConfigMessage,
} from './openaiRealtimeEvents.js';

export const REALTIME_URL = 'wss://api.openai.com/v1/realtime';

function buildRealtimeUrl(model) {
  return `${REALTIME_URL}?model=${encodeURIComponent(model)}`;
}

function safeErrorMessage(message, code = 'openai_realtime_error') {
  return buildClientEvent('error', {
    message,
    code,
  });
}

export class OpenAiRealtimeBridge extends EventEmitter {
  constructor({
    apiKey = OPENAI_API_KEY,
    model = OPENAI_REALTIME_MODEL,
    systemPrompt = OPENAI_REALTIME_SYSTEM_PROMPT,
    vadMode = OPENAI_REALTIME_VAD,
    WebSocketClass = WebSocket,
  } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.vadMode = vadMode;
    this.WebSocketClass = WebSocketClass;
    this.socket = null;
    this.mapper = new RealtimeEventMapper();
    this.closed = false;
    this.inputPaused = false;
    this.hasPendingAudio = false;
  }

  connect() {
    const configMessage = getMissingOpenAiConfigMessage(this.apiKey);
    if (configMessage) {
      this.emit('app-event', safeErrorMessage(configMessage, 'openai_realtime_missing_config'));
      this.handleClose();
      return;
    }

    const existingSocket = this.socket;
    if (
      existingSocket
      && (
        existingSocket.readyState === this.WebSocketClass.CONNECTING
        || existingSocket.readyState === this.WebSocketClass.OPEN
      )
    ) {
      this.socket = null;
      existingSocket.close(1000, 'Replacing live session');
    }

    this.closed = false;
    this.socket = new this.WebSocketClass(buildRealtimeUrl(this.model), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    const socket = this.socket;

    socket.on('open', () => {
      if (socket !== this.socket) {
        return;
      }

      this.sendOpenAi(buildRealtimeSessionUpdate({
        systemPrompt: this.systemPrompt,
        vadMode: this.vadMode,
      }));
    });

    socket.on('message', (data) => {
      if (socket !== this.socket) {
        return;
      }

      this.handleMessage(data);
    });

    socket.on('error', () => {
      if (socket !== this.socket) {
        return;
      }

      this.emit('app-event', safeErrorMessage(
        'AI conversation failed while connecting to OpenAI Realtime.',
        'openai_realtime_socket_error',
      ));
    });

    socket.on('close', () => {
      this.handleClose(socket);
    });
  }

  handleMessage(data) {
    let event;
    try {
      event = JSON.parse(data.toString());
    } catch {
      this.emit('app-event', safeErrorMessage(
        'AI conversation failed: received an unreadable realtime event.',
        'openai_realtime_parse_error',
      ));
      return;
    }

    for (const appEvent of this.mapper.map(event)) {
      this.emit('app-event', buildClientEvent(appEvent.type, appEvent));
    }
  }

  handleClose(socket = this.socket) {
    if (socket && socket !== this.socket) {
      return;
    }

    if (this.closed) {
      return;
    }

    this.closed = true;
    this.socket = null;
    this.emit('app-event', buildClientEvent('session.closed'));
    this.emit('close');
  }

  sendAudio(base64Audio) {
    if (this.closed || this.inputPaused || !base64Audio) {
      return false;
    }

    const sent = this.sendOpenAi({
      type: 'input_audio_buffer.append',
      audio: base64Audio,
    });

    if (sent) {
      this.hasPendingAudio = true;
    }

    return sent;
  }

  pauseInput() {
    this.inputPaused = true;
    this.hasPendingAudio = false;
    return this.sendOpenAi({ type: 'input_audio_buffer.clear' });
  }

  resumeInput() {
    this.inputPaused = false;
    return true;
  }

  commitInput() {
    if (this.closed || this.inputPaused || !this.hasPendingAudio) {
      return false;
    }

    const committed = this.sendOpenAi({ type: 'input_audio_buffer.commit' });
    if (!committed) {
      return false;
    }

    this.inputPaused = true;
    this.hasPendingAudio = false;
    this.sendOpenAi({ type: 'response.create' });
    return true;
  }

  cancelResponse() {
    return this.sendOpenAi({ type: 'response.cancel' });
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

  sendOpenAi(message) {
    if (!this.socket || this.socket.readyState !== this.WebSocketClass.OPEN) {
      return false;
    }

    this.socket.send(JSON.stringify(message));
    return true;
  }
}

export const OpenAIRealtimeBridge = OpenAiRealtimeBridge;
