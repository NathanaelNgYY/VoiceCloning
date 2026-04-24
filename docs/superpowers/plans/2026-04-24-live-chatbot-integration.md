# Live Chatbot Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Live tab's Faster Whisper phrase transcription flow with an OpenAI gpt-realtime conversational session whose text replies are synthesized only through the selected GPT-SoVITS cloned voice.

**Architecture:** The browser streams 24 kHz mono PCM chunks to a backend WebSocket at `/api/live/chat/realtime`. The backend owns the OpenAI Realtime WebSocket, maps OpenAI events into stable app events, and keeps the API key private. The frontend queues completed assistant text into the existing `/live/tts-sentence` route, so local mode synthesizes locally and cloud/S3 mode continues through the GPU worker.

**Tech Stack:** React 18, Vite, Express 4, Node ESM, `ws`, OpenAI Realtime WebSocket API, existing GPT-SoVITS HTTP synthesis path.

---

## File Structure

- Create `server/src/services/openaiRealtimeEvents.js`
  - Pure helpers for building session config and mapping OpenAI events to app events.
  - Testable without a network connection.

- Create `server/src/services/openaiRealtimeEvents.test.js`
  - Node built-in `node:test` coverage for event mapping, text buffering, and missing-key validation.

- Create `server/src/services/openaiRealtimeBridge.js`
  - Runtime OpenAI WebSocket wrapper.
  - Accepts audio chunks, pause/resume/cancel controls, and emits app events.

- Create `server/src/routes/liveChat.js`
  - Attaches a no-server WebSocket route to the existing HTTP server.
  - Owns browser socket validation and message forwarding.

- Modify `server/src/config.js`
  - Export OpenAI live env values.
  - Server startup still succeeds when `OPENAI_API_KEY` is empty.

- Modify `server/src/index.js`
  - Attach the live chat WebSocket server after `app.listen`.
  - Close the live chat WebSocket server during shutdown.
  - Remove server-side live Faster Whisper shutdown once cleanup task removes that service.

- Modify `server/package.json` and `server/package-lock.json`
  - Add `ws`.
  - Add a targeted test script for the OpenAI event helpers.

- Modify `server/.env.backend.deployment`
  - Add empty OpenAI live env entries that the deployer can fill.

- Modify `client/src/lib/runtimeConfig.js`
  - Add a WebSocket URL resolver that works for same-origin local mode and separate-origin cloud mode.

- Create `client/src/services/liveChatSocket.js`
  - Small browser WebSocket wrapper for Live chat messages.

- Modify `client/src/hooks/useLiveSpeech.js`
  - Replace Live Faster Whisper queueing with OpenAI Realtime socket streaming.
  - Keep existing cloned-voice synthesis queue and retry behavior.
  - Keep local mic level metering.
  - Add half-duplex pause and interruption behavior.

- Modify `client/src/pages/LivePage.jsx`
  - Update copy, controls, statuses, and reply list labels.
  - Remove silence-before-inference slider and Faster Whisper warning.

- Modify `client/src/services/api.js`
  - Remove Live-only upload/transcribe helpers after `useLiveSpeech.js` stops importing them.
  - Keep `/transcribe` for the Inference page.

- Modify `server/src/routes/upload.js`
  - Remove Live-only `/live/upload`, `/live/upload/presign`, and `/live/transcribe-phrase` handlers after frontend no longer calls them.
  - Keep training upload, reference upload, and S3 reference upload behavior unchanged.

- Modify `gpu-worker/src/routes/transcribe.js`
  - Remove Live-only `/live/transcribe-phrase` handler.
  - Keep regular `/transcribe` for existing reference audio transcription.

- Delete Live-only Faster Whisper worker files if no references remain:
  - `server/src/services/liveTranscriber.js`
  - `server/src/python/faster_whisper_worker.py`
  - `server/src/python/__pycache__/faster_whisper_worker.cpython-39.pyc`
  - `gpu-worker/src/services/liveTranscriber.js`
  - `gpu-worker/src/python/faster_whisper_worker.py`
  - `gpu-worker/src/python/__pycache__/faster_whisper_worker.cpython-39.pyc`

---

### Task 1: Add OpenAI Live Config, Dependency, And Test Script

**Files:**
- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Modify: `server/src/config.js`
- Modify: `server/.env.backend.deployment`

- [ ] **Step 1: Install the backend WebSocket dependency**

Run:

```powershell
npm --prefix server install ws
```

Expected:

```text
added 1 package
```

or:

```text
up to date
```

- [ ] **Step 2: Add the targeted test script**

Modify `server/package.json` so the `scripts` object includes:

```json
{
  "start": "node src/index.js",
  "dev": "node src/index.js",
  "build:client": "npm --prefix ../client run build",
  "test:live-chat": "node --test src/services/openaiRealtimeEvents.test.js"
}
```

- [ ] **Step 3: Add OpenAI env parsing to `server/src/config.js`**

Add these constants near the other top-level env constants:

```js
const OPENAI_API_KEY = readEnv('OPENAI_API_KEY');
const OPENAI_REALTIME_MODEL = readEnv('OPENAI_REALTIME_MODEL') || 'gpt-realtime';
const OPENAI_REALTIME_VAD = parseModeEnv(
  readEnv('OPENAI_REALTIME_VAD'),
  'semantic_vad',
  ['semantic_vad', 'server_vad'],
);
const OPENAI_REALTIME_SYSTEM_PROMPT =
  readEnv('OPENAI_REALTIME_SYSTEM_PROMPT') ||
  'You are a casual, helpful assistant. Keep replies concise and conversational.';
```

Add these exports to the existing export block:

```js
  OPENAI_API_KEY,
  OPENAI_REALTIME_MODEL,
  OPENAI_REALTIME_VAD,
  OPENAI_REALTIME_SYSTEM_PROMPT,
```

Do not include `OPENAI_API_KEY` in `getBackendConfigError()`. The server must start without the key.

- [ ] **Step 4: Add deployment env placeholders**

Append to `server/.env.backend.deployment`:

```env

OPENAI_API_KEY=
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VAD=semantic_vad
OPENAI_REALTIME_SYSTEM_PROMPT=You are a casual, helpful assistant. Keep replies concise and conversational.
```

- [ ] **Step 5: Verify config import still works**

Run:

```powershell
node --input-type=module -e "import('./server/src/config.js').then((m)=>console.log(m.OPENAI_REALTIME_MODEL, m.OPENAI_REALTIME_VAD, Boolean(m.OPENAI_API_KEY)))"
```

Expected output includes:

```text
gpt-realtime semantic_vad false
```

- [ ] **Step 6: Commit**

Run:

```powershell
git add server/package.json server/package-lock.json server/src/config.js server/.env.backend.deployment
git commit -m "chore: add openai realtime live config"
```

---

### Task 2: Add Testable OpenAI Realtime Event Helpers

**Files:**
- Create: `server/src/services/openaiRealtimeEvents.js`
- Modify: `server/src/services/openaiRealtimeEvents.test.js`

- [ ] **Step 1: Create the failing event helper tests**

Replace the placeholder contents of `server/src/services/openaiRealtimeEvents.test.js` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RealtimeEventMapper,
  buildRealtimeSessionUpdate,
  getMissingOpenAiConfigMessage,
} from './openaiRealtimeEvents.js';

test('buildRealtimeSessionUpdate configures text-only OpenAI responses', () => {
  const message = buildRealtimeSessionUpdate({
    systemPrompt: 'You are casual.',
    vadMode: 'semantic_vad',
  });

  assert.equal(message.type, 'session.update');
  assert.equal(message.session.type, 'realtime');
  assert.deepEqual(message.session.output_modalities, ['text']);
  assert.equal(message.session.instructions, 'You are casual.');
  assert.equal(message.session.audio.input.format.type, 'audio/pcm');
  assert.equal(message.session.audio.input.format.rate, 24000);
  assert.equal(message.session.audio.input.turn_detection.type, 'semantic_vad');
  assert.equal(message.session.audio.input.turn_detection.create_response, true);
  assert.equal(message.session.audio.input.turn_detection.interrupt_response, true);
});

test('buildRealtimeSessionUpdate configures server VAD when requested', () => {
  const message = buildRealtimeSessionUpdate({
    systemPrompt: 'You are casual.',
    vadMode: 'server_vad',
  });

  assert.equal(message.session.audio.input.turn_detection.type, 'server_vad');
  assert.equal(message.session.audio.input.turn_detection.threshold, 0.5);
  assert.equal(message.session.audio.input.turn_detection.silence_duration_ms, 650);
});

test('RealtimeEventMapper maps speech lifecycle events', () => {
  const mapper = new RealtimeEventMapper();

  assert.deepEqual(mapper.map({ type: 'session.updated' }), [{ type: 'session.ready' }]);
  assert.deepEqual(mapper.map({ type: 'input_audio_buffer.speech_started' }), [
    { type: 'user.speech.started' },
  ]);
  assert.deepEqual(mapper.map({ type: 'input_audio_buffer.speech_stopped' }), [
    { type: 'user.speech.stopped' },
  ]);
});

test('RealtimeEventMapper accumulates assistant text deltas and emits final text once', () => {
  const mapper = new RealtimeEventMapper();

  assert.deepEqual(mapper.map({
    type: 'response.output_text.delta',
    response_id: 'resp_1',
    delta: 'Hello',
  }), [{ type: 'assistant.text.delta', text: 'Hello' }]);

  assert.deepEqual(mapper.map({
    type: 'response.output_text.delta',
    response_id: 'resp_1',
    delta: ' there',
  }), [{ type: 'assistant.text.delta', text: ' there' }]);

  assert.deepEqual(mapper.map({
    type: 'response.output_text.done',
    response_id: 'resp_1',
    text: 'Hello there',
  }), [{ type: 'assistant.text.done', text: 'Hello there' }]);

  assert.deepEqual(mapper.map({
    type: 'response.output_text.done',
    response_id: 'resp_1',
    text: 'Hello there',
  }), []);
});

test('RealtimeEventMapper maps OpenAI errors to user-safe app errors', () => {
  const mapper = new RealtimeEventMapper();

  assert.deepEqual(mapper.map({
    type: 'error',
    error: { message: 'invalid API key', code: 'invalid_api_key' },
  }), [{
    type: 'error',
    message: 'AI conversation failed: invalid API key',
    code: 'invalid_api_key',
  }]);
});

test('getMissingOpenAiConfigMessage returns a live-specific message only without a key', () => {
  assert.equal(
    getMissingOpenAiConfigMessage(''),
    'OpenAI Realtime is not configured. Set OPENAI_API_KEY on the backend.',
  );
  assert.equal(getMissingOpenAiConfigMessage('sk-test'), '');
});
```

- [ ] **Step 2: Run the tests and verify they fail because the helper file does not exist**

Run:

```powershell
npm --prefix server run test:live-chat
```

Expected:

```text
ERR_MODULE_NOT_FOUND
```

- [ ] **Step 3: Create the event helper implementation**

Create `server/src/services/openaiRealtimeEvents.js`:

```js
const DEFAULT_SYSTEM_PROMPT =
  'You are a casual, helpful assistant. Keep replies concise and conversational.';

function cleanText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function responseKey(event) {
  return event.response_id || event.item_id || event.event_id || 'default';
}

export function getMissingOpenAiConfigMessage(apiKey) {
  return apiKey
    ? ''
    : 'OpenAI Realtime is not configured. Set OPENAI_API_KEY on the backend.';
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
      max_output_tokens: 220,
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

    const key = responseKey(event);
    const current = this.buffers.get(key) || '';
    this.buffers.set(key, `${current}${delta}`);
    return [{ type: 'assistant.text.delta', text: delta }];
  }

  mapTextDone(event) {
    const key = responseKey(event);
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
      for (const part of content) {
        if (part.type === 'output_text' && part.text) {
          textParts.push(part.text);
        }
      }
    }

    const text = cleanText(textParts.join(' ') || this.buffers.get(key) || '');
    this.completed.add(key);
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
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```powershell
npm --prefix server run test:live-chat
```

Expected:

```text
# pass 6
```

- [ ] **Step 5: Commit**

Run:

```powershell
git add server/src/services/openaiRealtimeEvents.js server/src/services/openaiRealtimeEvents.test.js
git commit -m "test: add openai realtime event mapping"
```

---

### Task 3: Implement The Backend OpenAI Realtime Bridge

**Files:**
- Create: `server/src/services/openaiRealtimeBridge.js`
- Modify: `server/src/services/openaiRealtimeEvents.test.js`

- [ ] **Step 1: Add bridge-shape tests for serializable client messages**

Append this test to `server/src/services/openaiRealtimeEvents.test.js`:

```js
import { buildClientEvent } from './openaiRealtimeEvents.js';

test('buildClientEvent keeps browser events JSON serializable', () => {
  assert.deepEqual(buildClientEvent('assistant.text.done', { text: 'Hi' }), {
    type: 'assistant.text.done',
    text: 'Hi',
  });
  assert.deepEqual(buildClientEvent('session.ready'), { type: 'session.ready' });
});
```

- [ ] **Step 2: Add `buildClientEvent` to `openaiRealtimeEvents.js`**

Add this export:

```js
export function buildClientEvent(type, payload = {}) {
  return { type, ...payload };
}
```

- [ ] **Step 3: Run tests**

Run:

```powershell
npm --prefix server run test:live-chat
```

Expected:

```text
# pass 7
```

- [ ] **Step 4: Create the bridge service**

Create `server/src/services/openaiRealtimeBridge.js`:

```js
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

const REALTIME_URL = 'wss://api.openai.com/v1/realtime';

function parseOpenAiMessage(data) {
  const raw = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  return JSON.parse(raw);
}

function isOpenSocket(socket) {
  return socket?.readyState === WebSocket.OPEN;
}

export class OpenAiRealtimeBridge extends EventEmitter {
  constructor({
    apiKey = OPENAI_API_KEY,
    model = OPENAI_REALTIME_MODEL,
    systemPrompt = OPENAI_REALTIME_SYSTEM_PROMPT,
    vadMode = OPENAI_REALTIME_VAD,
  } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.vadMode = vadMode;
    this.socket = null;
    this.mapper = new RealtimeEventMapper();
    this.closed = false;
    this.inputPaused = false;
  }

  connect() {
    const configMessage = getMissingOpenAiConfigMessage(this.apiKey);
    if (configMessage) {
      queueMicrotask(() => {
        this.emit('app-event', buildClientEvent('error', { message: configMessage }));
        this.emit('close');
      });
      return;
    }

    const url = `${REALTIME_URL}?model=${encodeURIComponent(this.model)}`;
    this.socket = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    this.socket.on('open', () => {
      this.sendOpenAi(buildRealtimeSessionUpdate({
        systemPrompt: this.systemPrompt,
        vadMode: this.vadMode,
      }));
    });

    this.socket.on('message', (data) => {
      let event;
      try {
        event = parseOpenAiMessage(data);
      } catch (err) {
        this.emit('app-event', buildClientEvent('error', {
          message: `AI conversation failed: ${err.message}`,
        }));
        return;
      }

      for (const appEvent of this.mapper.map(event)) {
        this.emit('app-event', appEvent);
      }
    });

    this.socket.on('error', (err) => {
      this.emit('app-event', buildClientEvent('error', {
        message: `AI conversation failed: ${err.message}`,
      }));
    });

    this.socket.on('close', () => {
      this.closed = true;
      this.emit('app-event', buildClientEvent('session.closed'));
      this.emit('close');
    });
  }

  sendAudio(base64Audio) {
    if (this.inputPaused || this.closed || !base64Audio || !isOpenSocket(this.socket)) {
      return;
    }

    this.sendOpenAi({
      type: 'input_audio_buffer.append',
      audio: base64Audio,
    });
  }

  pauseInput() {
    this.inputPaused = true;
    if (isOpenSocket(this.socket)) {
      this.sendOpenAi({ type: 'input_audio_buffer.clear' });
    }
  }

  resumeInput() {
    this.inputPaused = false;
  }

  cancelResponse() {
    if (isOpenSocket(this.socket)) {
      this.sendOpenAi({ type: 'response.cancel' });
    }
  }

  close() {
    this.closed = true;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.socket.close(1000, 'Live session ended');
    }
  }

  sendOpenAi(message) {
    if (!isOpenSocket(this.socket)) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```powershell
npm --prefix server run test:live-chat
```

Expected:

```text
# pass 7
```

- [ ] **Step 6: Commit**

Run:

```powershell
git add server/src/services/openaiRealtimeBridge.js server/src/services/openaiRealtimeEvents.js server/src/services/openaiRealtimeEvents.test.js
git commit -m "feat: add openai realtime bridge"
```

---

### Task 4: Attach The Browser-Facing Live Chat WebSocket Route

**Files:**
- Create: `server/src/routes/liveChat.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Create the route attachment module**

Create `server/src/routes/liveChat.js`:

```js
import { WebSocketServer } from 'ws';
import { CORS_ORIGINS, ALLOW_ALL_CORS } from '../config.js';
import { OpenAiRealtimeBridge } from '../services/openaiRealtimeBridge.js';

const LIVE_CHAT_PATH = '/api/live/chat/realtime';

function parseRequestUrl(req) {
  return new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
}

function originAllowed(origin) {
  if (!origin || ALLOW_ALL_CORS || CORS_ORIGINS.length === 0 || process.env.NODE_ENV !== 'production') {
    return true;
  }
  return CORS_ORIGINS.includes(origin);
}

function sendBrowser(socket, payload) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function handleBrowserMessage(bridge, data) {
  let message;
  try {
    message = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data || ''));
  } catch {
    return;
  }

  if (message.type === 'audio.chunk') {
    bridge.sendAudio(message.audio);
    return;
  }
  if (message.type === 'input.pause') {
    bridge.pauseInput();
    return;
  }
  if (message.type === 'input.resume') {
    bridge.resumeInput();
    return;
  }
  if (message.type === 'response.cancel') {
    bridge.cancelResponse();
  }
}

export function attachLiveChatSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = parseRequestUrl(req);
    if (url.pathname !== LIVE_CHAT_PATH) {
      return;
    }

    if (!originAllowed(req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (browserSocket) => {
      wss.emit('connection', browserSocket, req);
    });
  });

  wss.on('connection', (browserSocket) => {
    const bridge = new OpenAiRealtimeBridge();

    bridge.on('app-event', (event) => {
      sendBrowser(browserSocket, event);
    });
    bridge.on('close', () => {
      if (browserSocket.readyState === browserSocket.OPEN) {
        browserSocket.close(1000, 'AI conversation ended');
      }
    });

    browserSocket.on('message', (data) => {
      handleBrowserMessage(bridge, data);
    });
    browserSocket.on('close', () => {
      bridge.close();
    });
    browserSocket.on('error', () => {
      bridge.close();
    });

    bridge.connect();
  });

  return {
    close() {
      for (const client of wss.clients) {
        client.close(1001, 'Server shutting down');
      }
      wss.close();
    },
  };
}
```

- [ ] **Step 2: Attach the route in `server/src/index.js`**

Add import:

```js
import { attachLiveChatSocket } from './routes/liveChat.js';
```

After the server is created:

```js
const liveChatSocket = attachLiveChatSocket(server);
```

In `shutdown(signal)`, before the existing `server.close` call, add:

```js
  liveChatSocket.close();
```

- [ ] **Step 3: Run backend syntax and helper tests**

Run:

```powershell
npm --prefix server run test:live-chat
```

Expected:

```text
# pass 7
```

Run:

```powershell
node --check server/src/routes/liveChat.js
node --check server/src/services/openaiRealtimeBridge.js
node --check server/src/index.js
```

Expected: no output from each command.

- [ ] **Step 4: Commit**

Run:

```powershell
git add server/src/routes/liveChat.js server/src/index.js
git commit -m "feat: expose live chat websocket"
```

---

### Task 5: Add Frontend WebSocket URL And Socket Wrapper

**Files:**
- Modify: `client/src/lib/runtimeConfig.js`
- Create: `client/src/services/liveChatSocket.js`

- [ ] **Step 1: Add WebSocket URL resolution**

Add this function to `client/src/lib/runtimeConfig.js`:

```js
export function resolveWsPath(pathname) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const base = apiOrigin || (typeof window !== 'undefined' ? window.location.origin : '');
  const url = new URL(normalizedPath, base || 'http://localhost');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
```

- [ ] **Step 2: Create the browser socket wrapper**

Create `client/src/services/liveChatSocket.js`:

```js
import { resolveWsPath } from '@/lib/runtimeConfig';

const LIVE_CHAT_PATH = '/api/live/chat/realtime';

export function createLiveChatSocket({ onOpen, onMessage, onError, onClose } = {}) {
  const socket = new WebSocket(resolveWsPath(LIVE_CHAT_PATH));

  socket.addEventListener('open', () => {
    onOpen?.();
  });

  socket.addEventListener('message', (event) => {
    try {
      onMessage?.(JSON.parse(event.data));
    } catch (err) {
      onError?.(new Error(`Live chat message parse failed: ${err.message}`));
    }
  });

  socket.addEventListener('error', () => {
    onError?.(new Error('Live chat connection failed.'));
  });

  socket.addEventListener('close', () => {
    onClose?.();
  });

  return {
    get readyState() {
      return socket.readyState;
    },
    send(message) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, 'Live conversation ended');
      }
    },
  };
}
```

- [ ] **Step 3: Run client build**

Run:

```powershell
npm --prefix client run build
```

Expected:

```text
✓ built
```

- [ ] **Step 4: Commit**

Run:

```powershell
git add client/src/lib/runtimeConfig.js client/src/services/liveChatSocket.js
git commit -m "feat: add live chat socket client"
```

---

### Task 6: Refactor The Live Hook To Stream Conversation Audio

**Files:**
- Modify: `client/src/hooks/useLiveSpeech.js`

- [ ] **Step 1: Remove Live Faster Whisper imports**

Change the import block at the top of `client/src/hooks/useLiveSpeech.js` from:

```js
import {
  synthesizeSentence,
  transcribeAudio,
  transcribeLivePhrase,
  uploadLiveAudio,
} from '../services/api.js';
```

to:

```js
import { useEffect, useRef, useState } from 'react';
import { synthesizeSentence } from '../services/api.js';
import { createLiveChatSocket } from '../services/liveChatSocket.js';
```

Remove old constants and helpers used only for browser-side phrase cutting:

```text
LIVE_TARGET_SAMPLE_RATE
DEFAULT_LIVE_SILENCE_MS
LIVE_MIN_PHRASE_MS
LIVE_MAX_PHRASE_MS
LIVE_PREROLL_MS
getLiveAsrLanguage
concatFloat32
makeWavBlob
cloneSamples
```

Keep `V2_SUPPORTED_LANGS`, `QUESTION_START_RE`, `wait`, `normaliseTextLang`, `predictEnding`, `splitIntoPhrases`, `shouldRetrySynthesis`, `downsampleBuffer`, and `getRms`.

- [ ] **Step 2: Add PCM24 encoding helpers**

Add below `downsampleBuffer`:

```js
const OPENAI_INPUT_SAMPLE_RATE = 24000;
const INTERRUPTION_RMS_THRESHOLD = 0.024;

function encodePcm16Base64(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
}

function makeRealtimeAudioChunk(samples, inputSampleRate) {
  const downsampled = downsampleBuffer(samples, inputSampleRate, OPENAI_INPUT_SAMPLE_RATE);
  return encodePcm16Base64(downsampled);
}
```

- [ ] **Step 3: Replace hook signature and state model**

Change:

```js
export function useLiveSpeech({ refParams, silenceMs = DEFAULT_LIVE_SILENCE_MS }) {
  const [phase, setPhaseState] = useState('idle'); // idle | recording | processing
```

to:

```js
export function useLiveSpeech({ refParams }) {
  const [phase, setPhaseState] = useState('idle'); // idle | connecting | listening | thinking | speaking | stopping
  const [assistantDraft, setAssistantDraft] = useState('');
  const [notice, setNotice] = useState('');
```

Remove state and refs only used by transcription queues:

```js
pendingLiveAudioRef
isTranscribingLiveRef
mediaRecorderRef
chunksRef
preRollChunksRef
preRollSampleCountRef
phraseChunksRef
phraseSampleCountRef
phraseStartedRef
phraseStartMsRef
lastVoiceMsRef
liveClockMsRef
silenceMsRef
```

Add refs:

```js
  const chatSocketRef = useRef(null);
  const inputPausedRef = useRef(false);
  const playbackInterruptedRef = useRef(false);
```

- [ ] **Step 4: Replace sample handling**

Replace `handleLiveSamples` with:

```js
function handleLiveSamples(input, sampleRate, runId) {
  if (runId !== runIdRef.current || !['listening', 'thinking', 'speaking'].includes(phaseRef.current)) {
    return;
  }

  const samples = new Float32Array(input.length);
  samples.set(input);
  const rms = getRms(samples);

  if (phaseRef.current === 'speaking' && rms >= INTERRUPTION_RMS_THRESHOLD) {
    interruptPlayback();
    return;
  }

  if (inputPausedRef.current || phaseRef.current === 'speaking') {
    return;
  }

  try {
    const audio = makeRealtimeAudioChunk(samples, sampleRate);
    chatSocketRef.current?.send({ type: 'audio.chunk', audio });
  } catch (err) {
    setError(`Live audio encoding failed: ${err.message}`);
  }
}
```

- [ ] **Step 5: Replace audio capture setup**

Update `startLiveAudioCapture(stream, runId)` so it no longer resets phrase buffers and so its processor calls the new `handleLiveSamples`.

The function body should still:

- Create `AudioContext`.
- Create media stream source.
- Create analyser.
- Create `ScriptProcessorNode`.
- Connect source to analyser and processor.
- Fill the output buffer with zeros.
- Update mic level with `requestAnimationFrame`.

Use this processor callback:

```js
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);
      handleLiveSamples(input, audioCtx.sampleRate, runId);
    };
```

- [ ] **Step 6: Add socket event handling**

Add this function:

```js
function handleChatEvent(event, runId) {
  if (runId !== runIdRef.current || isCancelledRef.current) {
    return;
  }

  if (event.type === 'session.ready') {
    setPhase('listening');
    setNotice('Listening...');
    return;
  }

  if (event.type === 'user.speech.started') {
    setNotice('Listening...');
    return;
  }

  if (event.type === 'user.speech.stopped') {
    setPhase('thinking');
    setNotice('Thinking...');
    return;
  }

  if (event.type === 'assistant.thinking') {
    setPhase('thinking');
    setNotice('Thinking...');
    return;
  }

  if (event.type === 'assistant.text.delta') {
    setAssistantDraft((prev) => `${prev}${event.text || ''}`);
    return;
  }

  if (event.type === 'assistant.text.done') {
    const text = String(event.text || '').trim();
    setAssistantDraft('');
    if (text) {
      enqueuePhrase(text, refParams?.prompt_lang || 'en', 'assistant', runId);
    }
    return;
  }

  if (event.type === 'error') {
    setError(event.message || 'AI conversation failed.');
    setPhase('idle');
    stopLiveAudioCapture();
    closeChatSocket();
    return;
  }

  if (event.type === 'session.closed' && phaseRef.current !== 'idle') {
    setNotice('');
    setPhase('idle');
  }
}
```

- [ ] **Step 7: Add pause, resume, and interrupt helpers**

Add:

```js
function pauseOpenAiInput() {
  inputPausedRef.current = true;
  chatSocketRef.current?.send({ type: 'input.pause' });
}

function resumeOpenAiInput() {
  inputPausedRef.current = false;
  chatSocketRef.current?.send({ type: 'input.resume' });
}

function closeChatSocket() {
  chatSocketRef.current?.close();
  chatSocketRef.current = null;
}

function interruptPlayback() {
  playbackInterruptedRef.current = true;
  setSelectedClipId('');
  resumeOpenAiInput();
  setPhase('listening');
  setNotice('You interrupted. Listening...');
}
```

- [ ] **Step 8: Update synthesis completion behavior**

Inside `drainPhraseQueue`, after a clip becomes ready, set speaking state and pause OpenAI input:

```js
        pauseOpenAiInput();
        setPhase('speaking');
        setNotice('Paused while cloned voice is playing.');
        maybeSelectReadyClip(item.id);
```

Keep the existing retry and error update behavior.

- [ ] **Step 9: Replace `start`, `stop`, and `toggle`**

`start()` should:

- Require `refParams`.
- Require `getUserMedia`.
- Create new run id.
- Clear previous replies and errors.
- Open microphone stream.
- Start audio capture.
- Create `createLiveChatSocket`.
- Set phase to `connecting`.

Use this socket creation block:

```js
    setPhase('connecting');
    setNotice('Connecting...');
    chatSocketRef.current = createLiveChatSocket({
      onMessage: (event) => handleChatEvent(event, runId),
      onError: (err) => {
        if (!isCancelledRef.current && runId === runIdRef.current) {
          setError(err.message);
          setPhase('idle');
        }
      },
      onClose: () => {
        if (!isCancelledRef.current && runId === runIdRef.current && phaseRef.current !== 'idle') {
          setNotice('');
          setPhase('idle');
        }
      },
    });
```

`stop()` should:

- Set cancellation for the current run.
- Stop mic capture.
- Stop stream tracks.
- Close chat socket.
- Clear pending phrase work.
- Set phase to `idle`.

`toggle()` should:

```js
function toggle() {
  if (phaseRef.current === 'idle') {
    start();
    return;
  }
  if (phaseRef.current === 'speaking') {
    interruptPlayback();
    return;
  }
  stop();
}
```

- [ ] **Step 10: Update playback ended behavior**

Change `onAudioEnded()` so it resumes listening after the current ready clip ends:

```js
function onAudioEnded() {
  const nextClip = findNextReadyClip(selectedClipIdRef.current);
  if (nextClip) {
    waitingForNextReadyRef.current = false;
    setSelectedClipId(nextClip.id);
    setPhase('speaking');
    return;
  }

  waitingForNextReadyRef.current = true;
  if (!isCancelledRef.current && chatSocketRef.current) {
    resumeOpenAiInput();
    setPhase('listening');
    setNotice('Listening...');
  }
}
```

- [ ] **Step 11: Update returned values**

Return these values from the hook:

```js
  return {
    phase,
    interimTranscript: assistantDraft,
    finalTranscript,
    audioClips,
    selectedClip,
    selectedClipId,
    audioSrc: selectedClip?.status === 'ready' ? selectedClip.url : null,
    error,
    speechApiAvailable,
    audioLevel,
    notice,
    isConversationActive: phase !== 'idle',
    shouldPlayAudio: phase === 'speaking' && Boolean(selectedClip?.url),
    start,
    stop,
    toggle,
    interruptPlayback,
    selectClip,
    onAudioEnded,
  };
```

- [ ] **Step 12: Run client build**

Run:

```powershell
npm --prefix client run build
```

Expected:

```text
✓ built
```

- [ ] **Step 13: Commit**

Run:

```powershell
git add client/src/hooks/useLiveSpeech.js
git commit -m "feat: stream live audio to openai realtime"
```

---

### Task 7: Update The Live Page Conversation UI

**Files:**
- Modify: `client/src/pages/LivePage.jsx`

- [ ] **Step 1: Remove silence slider state and imports**

Remove the `LIVE_SILENCE_KEY` constant, the `silenceMs` state initializer, and the effect that writes `LIVE_SILENCE_KEY` back to localStorage. Also remove these imports:

```js
import { Slider } from '@/components/ui/slider';
import { Clock3 } from 'lucide-react';
```

Use this icon import:

```js
import { Activity, CircleAlert, Download, Loader2, Mic, PlayCircle } from 'lucide-react';
```

Change hook usage to:

```js
  const liveSpeech = useLiveSpeech({ refParams });
```

- [ ] **Step 2: Update playback effect**

Change `playbackReady` to:

```js
  const playbackReady = liveSpeech.shouldPlayAudio && Boolean(liveSpeech.audioSrc);
```

Keep the existing effect shape, but when `playbackReady` is false it must pause and unload the audio element.

- [ ] **Step 3: Update button labels and disabled logic**

Use:

```js
  const isActive = liveSpeech.isConversationActive;
  const buttonDisabled = !isReady || liveSpeech.phase === 'connecting' || liveSpeech.phase === 'stopping';
  const phaseLabel = {
    idle: 'Start conversation',
    connecting: 'Connecting...',
    listening: 'Stop conversation',
    thinking: 'Stop conversation',
    speaking: 'Interrupt',
    stopping: 'Stopping...',
  }[liveSpeech.phase] || 'Start conversation';
```

Use `aria-pressed={isActive}`.

- [ ] **Step 4: Update hero copy**

Replace the hero heading and body with:

```jsx
<h2 className="mt-5 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
  Chat live through a cloned voice.
</h2>
<p className="mt-4 max-w-2xl text-sm leading-7 text-white/72 sm:text-base">
  Start a conversation, speak naturally, and the assistant replies using the selected cloned voice.
</p>
```

- [ ] **Step 5: Replace the silence slider with half-duplex guidance**

Remove the whole silence slider card.

Insert this card below `MicLevelMeter`:

```jsx
<div className="w-full max-w-lg rounded-[22px] border border-slate-200 bg-white px-5 py-4 text-sm leading-6 text-slate-700 shadow-sm">
  The AI listens while you speak. When the cloned voice is playing, listening pauses.
  Speak again or tap the mic to interrupt.
</div>
```

- [ ] **Step 6: Replace transcript labels with conversation status**

Build display text:

```js
  const displayTranscript = [liveSpeech.finalTranscript, liveSpeech.interimTranscript]
    .filter(Boolean)
    .join(' ');
  const statusText = liveSpeech.notice || {
    idle: 'Ready to start',
    connecting: 'Connecting...',
    listening: 'Listening...',
    thinking: 'Thinking...',
    speaking: 'Speaking in cloned voice...',
    stopping: 'Stopping...',
  }[liveSpeech.phase];
```

Render a status card even when no assistant text exists:

```jsx
<div className="w-full max-w-lg rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-4">
  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
    {statusText}
  </p>
  {displayTranscript && (
    <p className="text-sm leading-7 text-foreground">
      {displayTranscript}
    </p>
  )}
</div>
```

- [ ] **Step 7: Remove Faster Whisper warning**

Delete the block that renders:

```text
Live Faster Whisper is unavailable here. Whisper will generate clips after you stop.
```

- [ ] **Step 8: Rename generated clips UI**

Change:

```text
Generated Clips
```

to:

```text
Conversation Replies
```

Change select placeholder to:

```jsx
<SelectValue placeholder="Select a ready reply" />
```

Change clip labels from `Clip` to `Reply` where visible:

```js
{`Reply ${clip.index}: ${clip.text.slice(0, 70)}`}
```

```jsx
Reply {clip.index}
```

Change download filename:

```jsx
download={`live_reply_${selectedClip?.index || 1}.wav`}
```

- [ ] **Step 9: Run client build**

Run:

```powershell
npm --prefix client run build
```

Expected:

```text
✓ built
```

- [ ] **Step 10: Commit**

Run:

```powershell
git add client/src/pages/LivePage.jsx
git commit -m "feat: update live tab for voice chatbot"
```

---

### Task 8: Remove Live-Only Faster Whisper Frontend And Backend Paths

**Files:**
- Modify: `client/src/services/api.js`
- Modify: `server/src/routes/upload.js`
- Modify: `server/src/index.js`
- Modify: `gpu-worker/src/routes/transcribe.js`
- Delete: `server/src/services/liveTranscriber.js`
- Delete: `server/src/python/faster_whisper_worker.py`
- Delete: `server/src/python/__pycache__/faster_whisper_worker.cpython-39.pyc`
- Delete: `gpu-worker/src/services/liveTranscriber.js`
- Delete: `gpu-worker/src/python/faster_whisper_worker.py`
- Delete: `gpu-worker/src/python/__pycache__/faster_whisper_worker.cpython-39.pyc`

- [ ] **Step 1: Confirm no frontend imports remain**

Run:

```powershell
git grep -n "transcribeLivePhrase\\|uploadLiveAudio" -- client/src
```

Expected: only definitions in `client/src/services/api.js`.

- [ ] **Step 2: Remove Live upload/transcribe helpers from `client/src/services/api.js`**

Delete these exports:

```text
uploadLiveAudio
transcribeLivePhrase
```

Keep:

```js
export function transcribeAudio(filePath, language = 'auto') {
  return api.post('/transcribe', { filePath, language });
}
```

- [ ] **Step 3: Remove Live-only imports from `server/src/routes/upload.js`**

Remove:

```js
import crypto from 'crypto';
import { spawn } from 'child_process';
import { liveTranscriber } from '../services/liveTranscriber.js';
```

Keep `crypto` only if another route in this file still uses it. If no remaining code uses `crypto`, remove the import.

- [ ] **Step 4: Remove Live-only upload and transcribe route code from `server/src/routes/upload.js`**

Delete these functions and routes:

```text
toClientPath
convertToWav
POST /live/upload
POST /live/transcribe-phrase
LIVE_UPLOAD_ALLOWED_TYPES
LIVE_UPLOAD_EXT_MAP
POST /live/upload/presign
```

Keep these existing routes intact:

```text
POST /upload
POST /upload-ref
POST /upload/presign
POST /upload/confirm
POST /upload-ref/presign
POST /upload-ref/confirm
```

- [ ] **Step 5: Remove server liveTranscriber shutdown**

In `server/src/index.js`, remove:

```js
import { liveTranscriber } from './services/liveTranscriber.js';
```

Remove this line from `shutdown(signal)`:

```js
  liveTranscriber.stop();
```

- [ ] **Step 6: Remove GPU worker live phrase transcription route**

In `gpu-worker/src/routes/transcribe.js`, remove:

```js
import { liveTranscriber } from '../services/liveTranscriber.js';
```

Delete:

```text
POST /live/transcribe-phrase
```

Keep the existing `POST /transcribe` route unchanged.

- [ ] **Step 7: Delete Live-only Faster Whisper worker files**

Run:

```powershell
Remove-Item -LiteralPath server/src/services/liveTranscriber.js
Remove-Item -LiteralPath server/src/python/faster_whisper_worker.py
Remove-Item -LiteralPath server/src/python/__pycache__/faster_whisper_worker.cpython-39.pyc
Remove-Item -LiteralPath gpu-worker/src/services/liveTranscriber.js
Remove-Item -LiteralPath gpu-worker/src/python/faster_whisper_worker.py
Remove-Item -LiteralPath gpu-worker/src/python/__pycache__/faster_whisper_worker.cpython-39.pyc
```

- [ ] **Step 8: Verify no live Faster Whisper references remain**

Run:

```powershell
git grep -n "liveTranscriber\\|faster_whisper_worker\\|transcribeLivePhrase\\|uploadLiveAudio"
```

Expected: no output.

Run:

```powershell
git grep -n "/live/transcribe-phrase\\|/live/upload" -- client/src server/src gpu-worker/src
```

Expected: no output.

- [ ] **Step 9: Run builds and syntax checks**

Run:

```powershell
npm --prefix client run build
npm --prefix server run test:live-chat
node --check server/src/routes/upload.js
node --check server/src/index.js
node --check gpu-worker/src/routes/transcribe.js
```

Expected:

```text
✓ built
# pass 7
```

The `node --check` commands produce no output.

- [ ] **Step 10: Commit**

Run:

```powershell
git add client/src/services/api.js server/src/routes/upload.js server/src/index.js gpu-worker/src/routes/transcribe.js
git rm server/src/services/liveTranscriber.js server/src/python/faster_whisper_worker.py server/src/python/__pycache__/faster_whisper_worker.cpython-39.pyc gpu-worker/src/services/liveTranscriber.js gpu-worker/src/python/faster_whisper_worker.py gpu-worker/src/python/__pycache__/faster_whisper_worker.cpython-39.pyc
git commit -m "refactor: remove live faster whisper path"
```

---

### Task 9: Verify Local And Cloud-Safe Behavior

**Files:**
- Modify: no source files unless verification finds a defect.

- [ ] **Step 1: Verify server starts without OpenAI key**

Run:

```powershell
$env:OPENAI_API_KEY=''; $env:GPT_SOVITS_ROOT=''; npm --prefix server start
```

Expected startup behavior:

```text
Server running on http://0.0.0.0:3000
```

Stop the process with `Ctrl+C`.

- [ ] **Step 2: Verify missing OpenAI key produces a Live-specific WebSocket error**

Start the server with no OpenAI key, then run this in another terminal:

```powershell
@'
import WebSocket from "ws";
const ws = new WebSocket("ws://127.0.0.1:3000/api/live/chat/realtime");
ws.on("message", (data) => {
  console.log(String(data));
  ws.close();
});
ws.on("error", (err) => {
  console.error(err.message);
  process.exitCode = 1;
});
'@ | node --input-type=module
```

Expected output:

```json
{"type":"error","message":"OpenAI Realtime is not configured. Set OPENAI_API_KEY on the backend."}
```

- [ ] **Step 3: Verify local build**

Run:

```powershell
npm --prefix client run build
npm --prefix server run test:live-chat
```

Expected:

```text
✓ built
# pass 7
```

- [ ] **Step 4: Verify no training routes changed**

Run:

```powershell
git diff development...HEAD -- server/src/routes/training.js gpu-worker/src/routes/training.js server/src/services/trainingSteps.js gpu-worker/src/services/trainingSteps.js
```

Expected: no diff.

- [ ] **Step 5: Verify normal Inference transcription remains**

Run:

```powershell
git grep -n "transcribeAudio" -- client/src/pages/InferencePage.jsx client/src/services/api.js
git grep -n "router.post('/transcribe'" -- server/src/routes/inference.js gpu-worker/src/routes/transcribe.js
```

Expected:

The command prints at least one matching line from each queried file.

- [ ] **Step 6: Verify cloud path still uses existing GPU worker synthesis**

Run:

```powershell
git grep -n "gpuWorkerClient.synthesize\\|/live/tts-sentence\\|INFERENCE_MODE" -- server/src
```

Expected output includes:

```text
server/src/routes/inference.js
server/src/services/inferenceServer.js
server/src/config.js
```

- [ ] **Step 7: Manual browser smoke test with OpenAI key**

Set `OPENAI_API_KEY` in `server/.env` or the shell environment. Start local services using the existing local development flow:

```powershell
cd server
npm run dev
```

In another terminal:

```powershell
cd client
npm run dev
```

Open `http://localhost:5173/live`.

Expected:

- Page requires loaded voice and reference audio as before.
- Start conversation opens the mic.
- Status reaches `Listening...`.
- Speaking produces an assistant text reply.
- The reply is synthesized through cloned voice only.
- While cloned voice plays, the UI says listening is paused.
- Speaking during cloned playback stops playback and returns to listening.

- [ ] **Step 8: Commit verification fixes if any**

If verification required source fixes, commit them:

```powershell
git add <changed-files>
git commit -m "fix: polish live chatbot integration"
```

If no fixes were needed, do not create an empty commit.
