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
  buildUserTextItem,
  buildVideoPositionItem,
  getMissingOpenAiConfigMessage,
  normalizeUserText,
} from './openaiRealtimeEvents.js';

export const REALTIME_URL = 'wss://api.openai.com/v1/realtime';

// The browser reports the lesson video's position every few seconds, but the
// note is only injected when the student actually starts a turn, and only when
// the video has moved far enough to matter. Without this the conversation would
// accumulate a position note every few seconds for the whole session.
export const VIDEO_POSITION_MIN_DELTA_SECONDS = 2;

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
    language = 'en',
    WebSocketClass = WebSocket,
  } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.vadMode = vadMode;
    this.language = language;
    this.WebSocketClass = WebSocketClass;
    this.socket = null;
    this.mapper = new RealtimeEventMapper({ language: this.language });
    this.closed = false;
    this.inputPaused = false;
    this.hasPendingAudio = false;
    this.videoPositionSeconds = null;
    this.videoPaused = false;
    this.injectedVideoPositionSeconds = null;
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
        language: this.language,
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

    // The student has begun a turn — this is the last moment their video
    // position can still reach the model before it answers.
    if (event.type === 'input_audio_buffer.speech_started') {
      this.injectVideoPosition();
    }

    for (const appEvent of this.mapper.map(event)) {
      this.emit('app-event', buildClientEvent(appEvent.type, appEvent));
    }
  }

  setVideoPosition({ seconds, paused = false } = {}) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) {
      return false;
    }

    this.videoPositionSeconds = value;
    this.videoPaused = Boolean(paused);
    return true;
  }

  // Returns true when a note was actually sent, so tests and callers can tell
  // an injection from a deliberate skip.
  injectVideoPosition() {
    if (this.closed || this.videoPositionSeconds === null) {
      return false;
    }

    const previous = this.injectedVideoPositionSeconds;
    if (
      previous !== null
      && Math.abs(this.videoPositionSeconds - previous) < VIDEO_POSITION_MIN_DELTA_SECONDS
    ) {
      return false;
    }

    const sent = this.sendOpenAi(buildVideoPositionItem(this.videoPositionSeconds, {
      paused: this.videoPaused,
    }));
    if (sent) {
      this.injectedVideoPositionSeconds = this.videoPositionSeconds;
    }
    return sent;
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

  // A typed turn. Unlike audio, there is no VAD to decide the turn is over, so
  // this asks for the response itself.
  sendText(text) {
    const value = normalizeUserText(text);
    if (this.closed || !value) {
      return false;
    }

    // A typed turn is still a turn: the student's video position has to reach
    // the model here, exactly as it does when speech starts.
    this.injectVideoPosition();

    if (!this.sendOpenAi(buildUserTextItem(value))) {
      return false;
    }

    // A typed turn produces no transcription event, because there is no audio to
    // transcribe — `user.text.done` only ever arrives for speech. Without this
    // the stored transcript keeps every reply and none of the questions, which
    // reads as a working transcript right up until someone tries to use it.
    //
    // Deliberately not an `app-event`: those are forwarded to the browser, which
    // already rendered this text when the student pressed enter, and a second
    // copy would show up as a duplicate bubble.
    this.emit('transcript-turn', { role: 'user', text: value });

    // Whatever the mic half-captured while they were typing is not part of this
    // turn, and must not be committed on top of it.
    if (this.hasPendingAudio) {
      this.hasPendingAudio = false;
      this.sendOpenAi({ type: 'input_audio_buffer.clear' });
    }

    this.sendOpenAi({ type: 'response.create' });
    return true;
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
