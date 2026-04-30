# ElevenLabs Voice Cloning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GPT-SoVITS with ElevenLabs API for voice cloning and TTS, keeping the OpenAI Realtime live chatbot (STT + LLM) completely intact.

**Architecture:** Merge `main` first to get the clean live-chatbot baseline. Strip all GPT-SoVITS server code (training pipeline, inference server, Python process management) and replace with three new server routes: voices (list/clone/delete) and tts. On the client, replace the Training page with a simple Voice Cloning page, simplify Inference to a voice-picker + TTS player, and rewire the live-chat synthesis calls from GPT-SoVITS endpoints to `/api/tts`. Voice selection persists via `localStorage` so Live pages pick it up automatically.

**Tech Stack:** Node.js/Express (server, ESM), React 18/Vite/shadcn-ui/Tailwind (client), ElevenLabs REST API (voice cloning + TTS), OpenAI Realtime API via WebSocket (STT + LLM — untouched).

---

## File Map

**Server — Create:**
- `server/src/services/elevenlabsClient.js` — ElevenLabs REST API wrapper (listVoices, cloneVoice, deleteVoice, textToSpeech)
- `server/src/routes/voices.js` — GET /api/voices, POST /api/voices/clone, DELETE /api/voices/:voiceId
- `server/src/routes/tts.js` — POST /api/tts

**Server — Replace entirely:**
- `server/src/config.js` — remove all GPT-SoVITS/S3/Python vars; add ELEVENLABS_API_KEY + ELEVENLABS_DEFAULT_MODEL
- `server/src/index.js` — wire new routes; strip processManager, inferenceServer, training, inference, upload

**Server — Delete:**
- `server/src/routes/upload.js`
- `server/src/routes/training.js`
- `server/src/routes/inference.js`
- `server/src/services/inferenceServer.js`
- `server/src/services/pipeline.js`
- `server/src/services/trainingSteps.js`
- `server/src/services/configGenerator.js`
- `server/src/services/processManager.js`
- `server/src/services/longTextInference.js`

**Client — Create:**
- `client/src/pages/CloningPage.jsx` — upload audio + clone voice + list/delete voices

**Client — Replace entirely:**
- `client/src/pages/InferencePage.jsx` — voice dropdown + text area + TTS playback only
- `client/src/services/api.js` — remove all GPT-SoVITS calls; add getVoices, cloneVoice, deleteVoice, tts, synthesize, synthesizeSentence

**Client — Modify:**
- `client/src/pages/LivePage.jsx` — replace refParams/serverReady with voiceId from localStorage
- `client/src/hooks/useLiveSpeech.js` — replace refParams prop with voiceId; simplify synthesis call params
- `client/src/hooks/liveConversation.js` — remove buildLiveReplyParams, buildLiveSentenceParams, LIVE_TEXT_LANG
- `client/src/App.jsx` — rename nav, update branding, remove GpuInstanceControl, swap TrainingPage→CloningPage

---

## Task 1: Merge main and set API key

**Files:**
- Modify: `server/.env`

- [ ] **Step 1: Merge main into elevenlabs-chatbot**

```bash
git fetch origin
git merge origin/main
```

If there are merge conflicts on client pages or hooks, accept `main`'s version — it has the live chatbot code this branch needs.

- [ ] **Step 2: Add ELEVENLABS_API_KEY to server/.env**

Open `server/.env` and add this line (keep `OPENAI_API_KEY` — still needed for live chat):
```
ELEVENLABS_API_KEY=your_actual_key_here
```

- [ ] **Step 3: Verify both servers still start after the merge**

Terminal 1:
```bash
cd server && npm run dev
```
Expected: starts on port 3000. Config warnings about `GPT_SOVITS_ROOT` are fine for now.

Terminal 2:
```bash
cd client && npm run dev
```
Expected: starts on port 5173. Stop both once confirmed.

---

## Task 2: Replace server/src/config.js

**Files:**
- Replace: `server/src/config.js`

- [ ] **Step 1: Replace the entire file**

Overwrite `server/src/config.js` with:

```javascript
import path from 'path';
import { fileURLToPath } from 'url';
import { loadOptionalEnvFile } from './utils/env.js';

const CONFIG_FILE = fileURLToPath(new URL('../.env', import.meta.url));
loadOptionalEnvFile(CONFIG_FILE);

function readEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function parseIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseListEnv(value) {
  if (!value) return [];
  return value.split(',').map(entry => entry.trim()).filter(Boolean);
}

const SERVER_DIR = path.dirname(CONFIG_FILE);
const PROJECT_ROOT = path.resolve(SERVER_DIR, '..');
const NODE_ENV = readEnv('NODE_ENV') || 'development';

const OPENAI_API_KEY = readEnv('OPENAI_API_KEY');
const OPENAI_REALTIME_MODEL = readEnv('OPENAI_REALTIME_MODEL') || 'gpt-4o-realtime-preview';
const OPENAI_REALTIME_VAD = (() => {
  const v = readEnv('OPENAI_REALTIME_VAD').trim().toLowerCase();
  return ['semantic_vad', 'server_vad'].includes(v) ? v : 'semantic_vad';
})();
const OPENAI_REALTIME_SYSTEM_PROMPT =
  readEnv('OPENAI_REALTIME_SYSTEM_PROMPT') ||
  'You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English.';

const ELEVENLABS_API_KEY = readEnv('ELEVENLABS_API_KEY');
const ELEVENLABS_DEFAULT_MODEL = readEnv('ELEVENLABS_DEFAULT_MODEL') || 'eleven_turbo_v2_5';

const SERVER_HOST = readEnv('SERVER_HOST', 'HOST') || '0.0.0.0';
const SERVER_PORT = parseIntegerEnv(readEnv('PORT', 'SERVER_PORT'), 3000);
const TRUST_PROXY = parseBooleanEnv(readEnv('TRUST_PROXY'), true);
const SERVE_CLIENT_DIST = parseBooleanEnv(readEnv('SERVE_CLIENT_DIST'), NODE_ENV === 'production');
const CLIENT_DIST_DIR = readEnv('CLIENT_DIST_DIR')
  ? path.resolve(readEnv('CLIENT_DIST_DIR'))
  : path.resolve(PROJECT_ROOT, 'client', 'dist');
const CORS_ORIGINS = parseListEnv(readEnv('CORS_ORIGINS'));
const ALLOW_ALL_CORS = CORS_ORIGINS.includes('*');

function getConfigError() {
  if (!ELEVENLABS_API_KEY) return 'ELEVENLABS_API_KEY is not set. Add it to server/.env';
  return null;
}

const startupError = getConfigError();
if (startupError) console.warn(`[config] ${startupError}`);

export {
  NODE_ENV,
  PROJECT_ROOT,
  OPENAI_API_KEY,
  OPENAI_REALTIME_MODEL,
  OPENAI_REALTIME_VAD,
  OPENAI_REALTIME_SYSTEM_PROMPT,
  ELEVENLABS_API_KEY,
  ELEVENLABS_DEFAULT_MODEL,
  SERVER_HOST,
  SERVER_PORT,
  TRUST_PROXY,
  SERVE_CLIENT_DIST,
  CLIENT_DIST_DIR,
  CORS_ORIGINS,
  ALLOW_ALL_CORS,
  getConfigError,
};
```

---

## Task 3: Create server/src/services/elevenlabsClient.js

**Files:**
- Create: `server/src/services/elevenlabsClient.js`

- [ ] **Step 1: Create the file**

```javascript
import { ELEVENLABS_API_KEY, ELEVENLABS_DEFAULT_MODEL } from '../config.js';

const BASE_URL = 'https://api.elevenlabs.io/v1';

function authHeaders(extra = {}) {
  return { 'xi-api-key': ELEVENLABS_API_KEY, ...extra };
}

export async function listVoices() {
  const res = await fetch(`${BASE_URL}/voices`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`ElevenLabs listVoices failed: ${res.status}`);
  const data = await res.json();
  return data.voices
    .filter(v => v.category === 'cloned')
    .map(v => ({ voiceId: v.voice_id, name: v.name }));
}

export async function cloneVoice(name, multerFiles) {
  const form = new FormData();
  form.append('name', name);
  for (const file of multerFiles) {
    const blob = new Blob([file.buffer], { type: file.mimetype || 'audio/wav' });
    form.append('files', blob, file.originalname);
  }
  const res = await fetch(`${BASE_URL}/voices/add`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs cloneVoice failed: ${res.status} — ${text}`);
  }
  const data = await res.json();
  return { voiceId: data.voice_id, name };
}

export async function deleteVoice(voiceId) {
  const res = await fetch(`${BASE_URL}/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`ElevenLabs deleteVoice failed: ${res.status}`);
}

export async function textToSpeech(voiceId, text, modelId = ELEVENLABS_DEFAULT_MODEL) {
  const res = await fetch(
    `${BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text, model_id: modelId }),
    }
  );
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`ElevenLabs TTS failed: ${res.status} — ${errorText}`);
  }
  return res;
}
```

---

## Task 4: Create server/src/routes/voices.js

**Files:**
- Create: `server/src/routes/voices.js`

- [ ] **Step 1: Create the file**

```javascript
import { Router } from 'express';
import multer from 'multer';
import { listVoices, cloneVoice, deleteVoice } from '../services/elevenlabsClient.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter(_req, file, cb) {
    const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    cb(null, ['.wav', '.mp3', '.ogg', '.flac', '.m4a'].includes(ext));
  },
});

router.get('/voices', async (_req, res) => {
  try {
    const voices = await listVoices();
    res.json(voices);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/voices/clone', upload.array('files', 20), async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!req.files?.length) return res.status(400).json({ error: 'at least one audio file is required' });
  try {
    const voice = await cloneVoice(name.trim(), req.files);
    res.json(voice);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.delete('/voices/:voiceId', async (req, res) => {
  try {
    await deleteVoice(req.params.voiceId);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
```

---

## Task 5: Create server/src/routes/tts.js

**Files:**
- Create: `server/src/routes/tts.js`

- [ ] **Step 1: Create the file**

```javascript
import { Router } from 'express';
import { textToSpeech } from '../services/elevenlabsClient.js';

const router = Router();

router.post('/tts', async (req, res) => {
  const { voiceId, text, modelId } = req.body;
  if (!voiceId) return res.status(400).json({ error: 'voiceId is required' });
  if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
  try {
    const elevenRes = await textToSpeech(voiceId, text.trim(), modelId);
    const buffer = Buffer.from(await elevenRes.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.end(buffer);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
```

---

## Task 6: Replace server/src/index.js

**Files:**
- Replace: `server/src/index.js`

- [ ] **Step 1: Replace the entire file**

```javascript
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import {
  SERVER_HOST,
  SERVER_PORT,
  TRUST_PROXY,
  SERVE_CLIENT_DIST,
  CLIENT_DIST_DIR,
  CORS_ORIGINS,
  ALLOW_ALL_CORS,
  getConfigError,
} from './config.js';
import voicesRoutes from './routes/voices.js';
import ttsRoutes from './routes/tts.js';
import { attachLiveChatSocket } from './routes/liveChat.js';

const app = express();

if (TRUST_PROXY) app.set('trust proxy', true);

if (ALLOW_ALL_CORS) {
  app.use(cors());
} else if (CORS_ORIGINS.length > 0) {
  app.use(cors({
    origin(origin, callback) {
      if (!origin || CORS_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by CORS'));
    },
  }));
} else if (process.env.NODE_ENV !== 'production') {
  app.use(cors());
}

app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'voice-cloning-server', timestamp: Date.now() });
});

app.get('/readyz', (_req, res) => {
  const configError = getConfigError();
  const ready = !configError;
  res.status(ready ? 200 : 503).json({ ready, configError });
});

app.get('/api/config', (_req, res) => {
  res.json({ storageMode: 'local' });
});

app.use('/api', voicesRoutes);
app.use('/api', ttsRoutes);

if (SERVE_CLIENT_DIST) {
  const indexPath = path.join(CLIENT_DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    app.use(express.static(CLIENT_DIST_DIR));
    app.get(/^\/(?!api(?:\/|$)|healthz$|readyz$).*/u, (_req, res) => {
      res.sendFile(indexPath);
    });
  } else {
    console.warn(`[client] SERVE_CLIENT_DIST is enabled but no build found at ${CLIENT_DIST_DIR}`);
  }
}

process.on('uncaughtException', (err) => console.error('[UNCAUGHT EXCEPTION]', err));
process.on('unhandledRejection', (reason) => console.error('[UNHANDLED REJECTION]', reason));

const server = app.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`Server running on http://${SERVER_HOST}:${SERVER_PORT}`);
});
const liveChatSocket = attachLiveChatSocket(server);

server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] Received ${signal}, stopping services...`);
  liveChatSocket.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
```

- [ ] **Step 2: Verify the server starts cleanly**

```bash
cd server && npm run dev
```
Expected: `Server running on http://0.0.0.0:3000` with no import errors.

- [ ] **Step 3: Smoke-test the new endpoints**

```bash
curl http://localhost:3000/api/voices
```
Expected: `[]` or a JSON array of your ElevenLabs cloned voices.

```bash
curl http://localhost:3000/healthz
```
Expected: `{"ok":true,"service":"voice-cloning-server",...}`

---

## Task 7: Delete GPT-SoVITS server files + commit

**Files:**
- Delete: `server/src/routes/upload.js`
- Delete: `server/src/routes/training.js`
- Delete: `server/src/routes/inference.js`
- Delete: `server/src/services/inferenceServer.js`
- Delete: `server/src/services/pipeline.js`
- Delete: `server/src/services/trainingSteps.js`
- Delete: `server/src/services/configGenerator.js`
- Delete: `server/src/services/processManager.js`
- Delete: `server/src/services/longTextInference.js`

- [ ] **Step 1: Delete the files**

```bash
cd server
rm src/routes/upload.js src/routes/training.js src/routes/inference.js
rm src/services/inferenceServer.js src/services/pipeline.js src/services/trainingSteps.js
rm src/services/configGenerator.js src/services/processManager.js src/services/longTextInference.js
```

- [ ] **Step 2: Confirm the server still starts without errors**

```bash
npm run dev
```
Expected: clean start with no missing-module errors.

- [ ] **Step 3: Commit all server changes**

```bash
cd ..
git add server/
git commit -m "feat: replace GPT-SoVITS server with ElevenLabs voices + TTS routes"
```

---

## Task 8: Replace client/src/services/api.js

**Files:**
- Replace: `client/src/services/api.js`

- [ ] **Step 1: Replace the entire file**

```javascript
import axios from 'axios';
import { API_BASE_URL } from '@/lib/runtimeConfig';

const api = axios.create({ baseURL: API_BASE_URL });

const SELECTED_VOICE_KEY = 'elevenlabs-selected-voice';

export function getSelectedVoiceId() {
  return localStorage.getItem(SELECTED_VOICE_KEY) || '';
}

export function setSelectedVoiceId(voiceId) {
  localStorage.setItem(SELECTED_VOICE_KEY, voiceId);
}

// ── Voices ──

export function getVoices() {
  return api.get('/voices');
}

export async function cloneVoice(name, files) {
  const formData = new FormData();
  formData.append('name', name);
  for (const file of files) {
    formData.append('files', file);
  }
  return api.post('/voices/clone', formData);
}

export function deleteVoice(voiceId) {
  return api.delete(`/voices/${voiceId}`);
}

// ── TTS ──

export async function tts(voiceId, text) {
  const res = await api.post('/tts', { voiceId, text }, {
    responseType: 'blob',
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    const errText = await res.data.text();
    let message;
    try { message = JSON.parse(errText).error; } catch { message = errText; }
    throw new Error(message || `TTS failed with status ${res.status}`);
  }

  return new Blob([res.data], { type: 'audio/mpeg' });
}

// ── Live chat synthesis (called by useLiveSpeech) ──

export async function synthesize({ voiceId, text }) {
  return tts(voiceId, text);
}

export async function synthesizeSentence({ voiceId, text }) {
  return tts(voiceId, text);
}
```

---

## Task 9: Create client/src/pages/CloningPage.jsx

**Files:**
- Create: `client/src/pages/CloningPage.jsx`

- [ ] **Step 1: Create the file**

```jsx
import React, { useEffect, useState } from 'react';
import AudioUploader from '../components/AudioUploader.jsx';
import { getVoices, cloneVoice, deleteVoice } from '../services/api.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Mic, Trash2 } from 'lucide-react';

export default function CloningPage() {
  const [voices, setVoices] = useState([]);
  const [name, setName] = useState('');
  const [files, setFiles] = useState([]);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function loadVoices() {
    try {
      const res = await getVoices();
      setVoices(res.data);
    } catch {
      // silently fail on list load
    }
  }

  useEffect(() => { loadVoices(); }, []);

  async function handleClone() {
    if (!name.trim() || files.length === 0) return;
    setCloning(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await cloneVoice(name.trim(), files);
      setSuccess(`Voice "${res.data.name}" cloned successfully.`);
      setName('');
      setFiles([]);
      await loadVoices();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Cloning failed.');
    } finally {
      setCloning(false);
    }
  }

  async function handleDelete(voiceId) {
    try {
      await deleteVoice(voiceId);
      await loadVoices();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Delete failed.');
    }
  }

  return (
    <div className="animate-fade-in space-y-8">
      <Card className="rounded-[22px] border-slate-200 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
              <Mic size={18} />
            </div>
            <div>
              <CardTitle className="text-base">Clone a new voice</CardTitle>
              <CardDescription className="text-xs">
                Upload audio samples — ElevenLabs will create a cloned voice in seconds
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="voice-name">Voice name</Label>
            <Input
              id="voice-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. My Voice"
              disabled={cloning}
            />
          </div>
          <AudioUploader files={files} onFilesChange={setFiles} disabled={cloning} />
          <Button
            onClick={handleClone}
            disabled={cloning || !name.trim() || files.length === 0}
            className="w-full rounded-xl"
          >
            {cloning ? 'Cloning...' : 'Clone Voice'}
          </Button>
          {success && <p className="text-sm text-emerald-600">{success}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-950">Your cloned voices</h2>
        {voices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cloned voices yet. Clone one above.</p>
        ) : (
          <ul className="space-y-2">
            {voices.map(v => (
              <li
                key={v.voiceId}
                className="flex items-center justify-between rounded-[16px] border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <span className="text-sm font-medium text-slate-900">{v.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(v.voiceId)}
                >
                  <Trash2 size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

---

## Task 10: Replace client/src/pages/InferencePage.jsx

**Files:**
- Replace: `client/src/pages/InferencePage.jsx`

- [ ] **Step 1: Replace the entire file**

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { getVoices, tts, setSelectedVoiceId } from '../services/api.js';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Volume2 } from 'lucide-react';

export default function InferencePage() {
  const [voices, setVoices] = useState([]);
  const [voiceId, setVoiceIdState] = useState(
    () => localStorage.getItem('elevenlabs-selected-voice') || ''
  );
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    getVoices()
      .then(res => setVoices(res.data))
      .catch(() => setError('Failed to load voices. Is the server running?'));
  }, []);

  function handleVoiceChange(id) {
    setVoiceIdState(id);
    setSelectedVoiceId(id);
  }

  async function handleGenerate() {
    if (!voiceId || !text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const blob = await tts(voiceId, text.trim());
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (err) {
      setError(err.message || 'Generation failed.');
    } finally {
      setLoading(false);
    }
  }

  const selectedVoiceName = voices.find(v => v.voiceId === voiceId)?.name || '';

  return (
    <div className="animate-fade-in space-y-6">
      <Card className="rounded-[22px] border-slate-200 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
              <Volume2 size={18} />
            </div>
            <div>
              <CardTitle className="text-base">Text to Speech</CardTitle>
              <CardDescription className="text-xs">
                Select a cloned voice and synthesize text
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label>Voice</Label>
            <Select value={voiceId} onValueChange={handleVoiceChange}>
              <SelectTrigger className="rounded-xl">
                <SelectValue placeholder="Select a cloned voice" />
              </SelectTrigger>
              <SelectContent>
                {voices.map(v => (
                  <SelectItem key={v.voiceId} value={v.voiceId}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {voiceId && selectedVoiceName && (
              <p className="text-xs text-muted-foreground">
                This voice will also be used in Live Chat.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tts-text">Text</Label>
            <Textarea
              id="tts-text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Enter text to synthesize..."
              rows={5}
              className="resize-none rounded-xl"
            />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={!voiceId || !text.trim() || loading}
            className="w-full rounded-xl"
          >
            {loading ? 'Generating...' : 'Generate'}
          </Button>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {audioUrl && (
            <audio ref={audioRef} src={audioUrl} controls className="w-full" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## Task 11: Update client/src/hooks/liveConversation.js

**Files:**
- Modify: `client/src/hooks/liveConversation.js`

- [ ] **Step 1: Remove GPT-SoVITS param builders**

These may already be removed by the `main` merge. Check if the following exist in the file:
- `export const LIVE_TEXT_LANG = 'en';`
- `export function buildLiveReplyParams(...)`
- `export function buildLiveSentenceParams(...)`

If they still exist, delete them. The file should export only: `LIVE_REPLY_MODES`, `cleanLiveText`, `splitLiveReplyPhrases`, `createChatMessage`, `updateMessage`, `findSelectedPlayback`, `findNextPhrasePlayback`.

---

## Task 12: Update client/src/hooks/useLiveSpeech.js

**Files:**
- Modify: `client/src/hooks/useLiveSpeech.js`

- [ ] **Step 1: Update the liveConversation import (line 6–14)**

Remove `buildLiveSentenceParams` and `buildLiveReplyParams` from the import:

```javascript
import {
  LIVE_REPLY_MODES,
  cleanLiveText,
  createChatMessage,
  findNextPhrasePlayback,
  findSelectedPlayback,
  splitLiveReplyPhrases,
  updateMessage,
} from './liveConversation.js';
```

- [ ] **Step 2: Change the function signature (line 90)**

Old:
```javascript
export function useLiveSpeech({ refParams, replyMode = LIVE_REPLY_MODES.full } = {}) {
```
New:
```javascript
export function useLiveSpeech({ voiceId, replyMode = LIVE_REPLY_MODES.full } = {}) {
```

- [ ] **Step 3: Update synthesizeFullAssistantReply**

Find `synthesizeFullAssistantReply` (around line 310). Make two changes:

Old guard:
```javascript
if (!refParams) return;
```
New:
```javascript
if (!voiceId) return;
```

Old synthesis call (inside the try block):
```javascript
const blob = await synthesizeWithRetry(buildLiveReplyParams(text, refParams));
```
New:
```javascript
const blob = await synthesizeWithRetry({ voiceId, text });
```

- [ ] **Step 4: Update synthesizePhraseAssistantReply**

Find `synthesizePhraseAssistantReply` (around line 351). Make two changes:

Old guard:
```javascript
if (!refParams) return;
```
New:
```javascript
if (!voiceId) return;
```

Old synthesis call (inside the for loop):
```javascript
const blob = await synthesizeSentenceWithRetry(
  buildLiveSentenceParams(phrases[index], refParams)
);
```
New:
```javascript
const blob = await synthesizeSentenceWithRetry({ voiceId, text: phrases[index] });
```

- [ ] **Step 5: Update the start() guard**

Find in `start()` (around line 674):

Old:
```javascript
if (!refParams) {
  setError('No reference audio configured. Go to the Inference page first.');
  return;
}
```
New:
```javascript
if (!voiceId) {
  setError('No voice selected. Go to the Inference page and select a voice first.');
  return;
}
```

---

## Task 13: Update client/src/pages/LivePage.jsx

**Files:**
- Modify: `client/src/pages/LivePage.jsx`

- [ ] **Step 1: Replace the api import at the top**

Old:
```javascript
import { getCurrentInference, getInferenceStatus } from '../services/api.js';
```
New:
```javascript
import { getSelectedVoiceId } from '../services/api.js';
```

- [ ] **Step 2: Replace state declarations and the init useEffect**

Remove these state declarations:
```javascript
const [serverReady, setServerReady] = useState(false);
const [loadedVoiceName, setLoadedVoiceName] = useState('');
const [refParams, setRefParams] = useState(null);
```

Remove the entire `useEffect(() => { async function init() { ... } init(); }, []);` block (roughly lines 149–198).

Replace all of the above with:
```javascript
const [voiceId] = useState(() => getSelectedVoiceId());
```

- [ ] **Step 3: Update the useLiveSpeech call**

Old:
```javascript
const liveSpeech = useLiveSpeech({ refParams, replyMode });
```
New:
```javascript
const liveSpeech = useLiveSpeech({ voiceId, replyMode });
```

- [ ] **Step 4: Update isReady**

Old:
```javascript
const isReady = serverReady && Boolean(refParams);
```
New:
```javascript
const isReady = Boolean(voiceId);
```

- [ ] **Step 5: Replace the "not ready" warning JSX**

Old (the amber warning block with two conditions):
```jsx
{!isReady && (
  <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
    {!serverReady ? (
      <>No voice model is loaded. <Link to="/inference" ...>Go to Inference</Link> to load one first.</>
    ) : (
      <>No reference audio found. <Link to="/inference" ...>Go to Inference</Link> and generate at least once...</>
    )}
  </div>
)}
```
New:
```jsx
{!isReady && (
  <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
    No voice selected.{' '}
    <Link to="/inference" className="font-semibold underline">
      Go to Inference
    </Link>{' '}
    and select a cloned voice first.
  </div>
)}
```

- [ ] **Step 6: Replace the Voice setup sidebar card content**

Find the `<aside>` section with the "Voice setup" card. Replace the card's inner content (the three fields: Model, Reference, Language) with:

```jsx
<div className="space-y-3 text-sm">
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Voice</p>
    <p className="mt-1 text-slate-800">{voiceId ? 'Selected' : 'Not selected'}</p>
  </div>
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Language</p>
    <p className="mt-1 text-slate-800">English only</p>
  </div>
</div>
```

---

## Task 14: Update client/src/App.jsx

**Files:**
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Remove GpuInstanceControl and its dependencies**

- Delete the import of `getInstanceStatus` and `startInstance` from `./services/api.js` (remove the entire `api.js` import line — App.jsx doesn't need api.js at all after this)
- Delete the import of `Power` from `lucide-react`
- Delete the entire `GpuInstanceControl` function (lines 12–94)
- Delete `<GpuInstanceControl />` from the JSX (inside the header `<div>`)

- [ ] **Step 2: Swap TrainingPage for CloningPage**

Change:
```javascript
import TrainingPage from './pages/TrainingPage.jsx';
```
To:
```javascript
import CloningPage from './pages/CloningPage.jsx';
```

Change:
```jsx
<Route path="/" element={<TrainingPage />} />
```
To:
```jsx
<Route path="/" element={<CloningPage />} />
```

- [ ] **Step 3: Rename the first nav link**

Change the `<span>Training</span>` text inside the first `NavLink` to `<span>Voice Cloning</span>`.

- [ ] **Step 4: Update branding**

In the header subtitle, change:
```jsx
GPT-SoVITS Training & Inference
```
To:
```jsx
ElevenLabs Voice Cloning
```

In the footer, change:
```jsx
Built with GPT-SoVITS
```
To:
```jsx
Built with ElevenLabs
```

- [ ] **Step 5: Commit all client changes**

```bash
git add client/
git commit -m "feat: replace GPT-SoVITS client with ElevenLabs voice cloning UI"
```

---

## Task 15: Smoke test the full app

- [ ] **Step 1: Start the server**

```bash
cd server && npm run dev
```
Expected: `Server running on http://0.0.0.0:3000` — no import errors, no config warnings (if `ELEVENLABS_API_KEY` is set).

- [ ] **Step 2: Start the client**

Second terminal:
```bash
cd client && npm run dev
```
Expected: Vite starts on port 5173, no TypeScript/build errors in the terminal.

- [ ] **Step 3: Test Voice Cloning page**

Open http://localhost:5173. Verify:
- Tab reads "Voice Cloning" (not "Training")
- Header subtitle reads "ElevenLabs Voice Cloning"
- No GPU instance button visible
- Upload 1+ audio files, enter a name, click "Clone Voice"
- Expected: success message appears, voice appears in "Your cloned voices" list

- [ ] **Step 4: Test Inference page**

Click "Inference" tab. Verify:
- Voice dropdown shows your cloned voice(s)
- No reference audio upload, no model loading UI
- Select a voice, type text, click "Generate"
- Expected: audio plays back in the browser. The hint "This voice will also be used in Live Chat" appears.

- [ ] **Step 5: Test Live Full page**

Click "Live Full" tab. Verify:
- If no voice selected: amber warning shows "No voice selected. Go to Inference..."
- After selecting a voice on Inference: mic button is enabled
- Click mic, speak, wait for reply
- Expected: OpenAI Realtime transcribes speech, generates reply, ElevenLabs synthesizes the cloned voice reply, audio plays back

- [ ] **Step 6: Final commit**

```bash
git add -p
git commit -m "feat: complete ElevenLabs voice cloning app"
```
