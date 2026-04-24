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

export class OpenAIRealtimeBridge extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.mapper = new RealtimeEventMapper();
    this.closed = false;
    this.inputPaused = false;
  }

  connect() {
    const configMessage = getMissingOpenAiConfigMessage(OPENAI_API_KEY);
    if (configMessage) {
      this.emit('app-event', safeErrorMessage(configMessage, 'openai_realtime_missing_config'));
      this.handleClose();
      return;
    }

    this.closed = false;
    this.socket = new WebSocket(buildRealtimeUrl(OPENAI_REALTIME_MODEL), {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    this.socket.on('open', () => {
      this.sendOpenAi(buildRealtimeSessionUpdate({
        systemPrompt: OPENAI_REALTIME_SYSTEM_PROMPT,
        vadMode: OPENAI_REALTIME_VAD,
      }));
    });

    this.socket.on('message', (data) => {
      this.handleMessage(data);
    });

    this.socket.on('error', () => {
      this.emit('app-event', safeErrorMessage(
        'AI conversation failed while connecting to OpenAI Realtime.',
        'openai_realtime_socket_error',
      ));
    });

    this.socket.on('close', () => {
      this.handleClose();
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

  handleClose() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.emit('app-event', buildClientEvent('session.closed'));
    this.emit('close');
  }

  sendAudio(base64Audio) {
    if (this.closed || this.inputPaused || !base64Audio) {
      return;
    }

    this.sendOpenAi({
      type: 'input_audio_buffer.append',
      audio: base64Audio,
    });
  }

  pauseInput() {
    this.inputPaused = true;
    this.sendOpenAi({ type: 'input_audio_buffer.clear' });
  }

  resumeInput() {
    this.inputPaused = false;
  }

  cancelResponse() {
    this.sendOpenAi({ type: 'response.cancel' });
  }

  close() {
    if (!this.socket) {
      this.handleClose();
      return;
    }

    if (
      this.socket.readyState === WebSocket.CONNECTING
      || this.socket.readyState === WebSocket.OPEN
    ) {
      this.socket.close(1000, 'Live session ended');
      return;
    }

    this.handleClose();
  }

  sendOpenAi(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(message));
  }
}

