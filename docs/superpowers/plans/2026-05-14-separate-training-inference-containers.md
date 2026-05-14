# Separate Training and Inference Containers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single `gpu-worker` into two self-contained containers — one for training, one for inference — so each can be deployed, scaled, and ported to other projects independently.

**Architecture:** A new `gpu-inference-worker` service is created alongside the existing `gpu-worker`. All inference-related routes and services are copied into it (no shared package — each container is fully self-contained). The existing `gpu-worker` is trimmed to training-only routes. The Lambda gains an optional `INFERENCE_WORKER_URL` env var that, when set, routes inference and model-loading calls to the inference container; it falls back to `GPU_WORKER_URL` so the live site keeps working with the current single-worker setup during the transition.

**Tech Stack:** Node.js + Express (ESM), AWS SDK v3 (S3), GPT-SoVITS Python integration (api_v2.py), Docker (nvidia/cuda base image)

---

## File Map

**Created:**
- `gpu-inference-worker/package.json`
- `gpu-inference-worker/src/index.js`
- `gpu-inference-worker/src/config.js`
- `gpu-inference-worker/src/utils/paths.js`
- `gpu-inference-worker/src/routes/inference.js`
- `gpu-inference-worker/src/routes/models.js`
- `gpu-inference-worker/src/routes/artifacts.js`
- `gpu-inference-worker/src/routes/activity.js`
- `gpu-inference-worker/src/services/activityState.js`
- `gpu-inference-worker/src/services/corsOrigin.js`
- `gpu-inference-worker/src/services/inferenceServer.js`
- `gpu-inference-worker/src/services/inferenceState.js`
- `gpu-inference-worker/src/services/longTextInference.js`
- `gpu-inference-worker/src/services/processManager.js`
- `gpu-inference-worker/src/services/s3Sync.js`
- `gpu-inference-worker/src/services/sseManager.js`
- `gpu-inference-worker/Dockerfile`
- `docker/gpu-inference-worker/entrypoint.sh`

**Modified:**
- `gpu-worker/src/index.js` — remove inference + models route mounts
- `gpu-worker/src/routes/artifacts.js` — remove `/inference/result` and `/ref-audio` routes
- `gpu-worker/src/routes/activity.js` — remove inference state references
- `lambda/shared/gpuWorker.js` — add `inferenceBaseUrl()` + inference-specific helpers
- `lambda/inference/index.js` — use inference worker helpers
- `lambda/models/index.js` — use inference worker for weight listing and loading

---

### Task 1: Scaffold gpu-inference-worker package

**Files:**
- Create: `gpu-inference-worker/package.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "voice-cloning-gpu-inference-worker",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node src/index.js"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.700.0",
    "cors": "^2.8.5",
    "express": "^4.21.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```
cd gpu-inference-worker && npm install
```

Expected: `node_modules/` created, `package-lock.json` written.

- [ ] **Step 3: Commit**

```
git add gpu-inference-worker/package.json gpu-inference-worker/package-lock.json
git commit -m "chore: scaffold gpu-inference-worker package"
```

---

### Task 2: Copy config and utility files

**Files:**
- Create: `gpu-inference-worker/src/config.js`
- Create: `gpu-inference-worker/src/utils/paths.js`
- Create: `gpu-inference-worker/src/services/corsOrigin.js`

- [ ] **Step 1: Create `gpu-inference-worker/src/config.js`**

Identical to `gpu-worker/src/config.js` — same env vars, same Python resolution. No changes needed because the inference worker needs the same GPT-SoVITS root and Python path.

```js
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const CONFIG_FILE = fileURLToPath(new URL('../.env', import.meta.url));

function loadOptionalEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadOptionalEnvFile(CONFIG_FILE);

function readEnv(key) { return process.env[key] || ''; }
function parseIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const rawGptSovitsRoot = readEnv('GPT_SOVITS_ROOT');

export const GPT_SOVITS_ROOT = rawGptSovitsRoot ? path.resolve(rawGptSovitsRoot) : '';
export const S3_BUCKET = readEnv('S3_BUCKET');
export const S3_REGION = readEnv('S3_REGION');
export const S3_PREFIX = readEnv('S3_PREFIX') || '';
export const WORKER_PORT = parseIntegerEnv(readEnv('WORKER_PORT'), 3001);
export const WORKER_HOST = readEnv('WORKER_HOST') || '0.0.0.0';
export const INFERENCE_HOST = readEnv('INFERENCE_HOST') || '127.0.0.1';
export const INFERENCE_PORT = parseIntegerEnv(readEnv('INFERENCE_PORT'), 9880);
export const LOCAL_TEMP_ROOT = readEnv('LOCAL_TEMP_ROOT') || path.join(GPT_SOVITS_ROOT, 'worker_temp');

const runtimeDir = path.join(GPT_SOVITS_ROOT, 'runtime');
const pythonCandidates = [
  process.env.PYTHON_EXEC || '',
  path.join(runtimeDir, 'bin', 'python'),
  path.join(runtimeDir, 'python.exe'),
].filter(Boolean);

export const PYTHON_EXEC = pythonCandidates.find(c => fs.existsSync(c))
  || (process.platform === 'win32' ? 'python.exe' : 'python3');

export const SCRIPTS = {
  apiServer: path.join(GPT_SOVITS_ROOT, 'api_v2.py'),
};

export function buildPythonEnv(extraEnv = {}) {
  return {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    PATH: [GPT_SOVITS_ROOT, process.env.PATH].filter(Boolean).join(path.delimiter),
    PYTHONPATH: [GPT_SOVITS_ROOT, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    ...extraEnv,
  };
}

if (!GPT_SOVITS_ROOT || !fs.existsSync(GPT_SOVITS_ROOT)) {
  console.warn(`[gpu-inference-worker] GPT_SOVITS_ROOT not found: ${GPT_SOVITS_ROOT}`);
}
if (!S3_BUCKET || !S3_REGION) {
  console.warn('[gpu-inference-worker] S3_BUCKET or S3_REGION not configured');
}
console.log(`[gpu-inference-worker] GPT-SoVITS root: ${GPT_SOVITS_ROOT}`);
console.log(`[gpu-inference-worker] Python: ${PYTHON_EXEC}`);
console.log(`[gpu-inference-worker] Inference server target: ${INFERENCE_HOST}:${INFERENCE_PORT}`);
```

Note: `SCRIPTS` only includes `apiServer` — training scripts are not needed here.

- [ ] **Step 2: Create `gpu-inference-worker/src/utils/paths.js`**

Identical copy from `gpu-worker/src/utils/paths.js`.

```js
import path from 'path';

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/u;

export function isSafePathSegment(value) {
  return SAFE_PATH_SEGMENT.test(String(value || ''));
}

export function isPathInside(candidatePath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function sanitizeFilename(filename, fallbackBase = 'file') {
  const ext = path.extname(filename || '').replace(/[^A-Za-z0-9.]/gu, '').slice(0, 16);
  const base = path
    .basename(filename || '', path.extname(filename || ''))
    .replace(/[^A-Za-z0-9._-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  return `${base || fallbackBase}${ext}`;
}
```

- [ ] **Step 3: Create `gpu-inference-worker/src/services/corsOrigin.js`**

Copy `gpu-worker/src/services/corsOrigin.js` verbatim. (Check that file and copy its content exactly.)

- [ ] **Step 4: Commit**

```
git add gpu-inference-worker/src/
git commit -m "chore: add gpu-inference-worker config and utils"
```

---

### Task 3: Copy shared runtime services

**Files:**
- Create: `gpu-inference-worker/src/services/s3Sync.js`
- Create: `gpu-inference-worker/src/services/sseManager.js`
- Create: `gpu-inference-worker/src/services/processManager.js`

All three are identical copies from `gpu-worker/src/services/`. They are duplicated (not symlinked) so the inference worker stays fully self-contained and portable.

- [ ] **Step 1: Create `gpu-inference-worker/src/services/s3Sync.js`**

Copy `gpu-worker/src/services/s3Sync.js` verbatim.

- [ ] **Step 2: Create `gpu-inference-worker/src/services/sseManager.js`**

Copy `gpu-worker/src/services/sseManager.js` verbatim.

- [ ] **Step 3: Create `gpu-inference-worker/src/services/processManager.js`**

Copy `gpu-worker/src/services/processManager.js` verbatim. (Inference worker needs this because `inferenceServer.js` spawns `api_v2.py` as a subprocess.)

- [ ] **Step 4: Commit**

```
git add gpu-inference-worker/src/services/
git commit -m "chore: add gpu-inference-worker shared runtime services"
```

---

### Task 4: Copy inference-specific services

**Files:**
- Create: `gpu-inference-worker/src/services/activityState.js`
- Create: `gpu-inference-worker/src/services/inferenceState.js`
- Create: `gpu-inference-worker/src/services/inferenceServer.js`
- Create: `gpu-inference-worker/src/services/longTextInference.js`

- [ ] **Step 1: Create `gpu-inference-worker/src/services/activityState.js`**

Copy `gpu-worker/src/services/activityState.js` verbatim. The inference worker will only ever have `trainingActive: false` and `trainingStatus: 'idle'` — the function handles this correctly already with no changes needed.

- [ ] **Step 2: Create `gpu-inference-worker/src/services/inferenceState.js`**

Copy `gpu-worker/src/services/inferenceState.js` verbatim.

- [ ] **Step 3: Create `gpu-inference-worker/src/services/inferenceServer.js`**

Copy `gpu-worker/src/services/inferenceServer.js` verbatim.

- [ ] **Step 4: Create `gpu-inference-worker/src/services/longTextInference.js`**

Copy `gpu-worker/src/services/longTextInference.js` verbatim.

- [ ] **Step 5: Commit**

```
git add gpu-inference-worker/src/services/
git commit -m "chore: add gpu-inference-worker inference services"
```

---

### Task 5: Create inference-worker routes

**Files:**
- Create: `gpu-inference-worker/src/routes/inference.js`
- Create: `gpu-inference-worker/src/routes/models.js`
- Create: `gpu-inference-worker/src/routes/artifacts.js`
- Create: `gpu-inference-worker/src/routes/activity.js`

- [ ] **Step 1: Create `gpu-inference-worker/src/routes/inference.js`**

Copy `gpu-worker/src/routes/inference.js` verbatim.

- [ ] **Step 2: Create `gpu-inference-worker/src/routes/models.js`**

Copy `gpu-worker/src/routes/models.js` verbatim. This covers `GET /models`, `POST /models/download`, and `POST /ref-audio/download`.

- [ ] **Step 3: Create `gpu-inference-worker/src/routes/artifacts.js`**

This is a **subset** of `gpu-worker/src/routes/artifacts.js` — only the inference result and ref-audio routes. Training audio routes stay in gpu-worker.

```js
import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { GPT_SOVITS_ROOT, LOCAL_TEMP_ROOT } from '../config.js';
import { isPathInside } from '../utils/paths.js';

const router = Router();
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.webm', '.mp4']);

function audioContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.mp4') return 'audio/mp4';
  return 'application/octet-stream';
}

function sendAudioFile(res, filePath) {
  const stat = fs.statSync(filePath);
  res.set({
    'Content-Type': audioContentType(filePath),
    'Content-Length': stat.size,
  });
  res.sendFile(filePath);
}

router.get('/inference/result/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  if (!/^[A-Za-z0-9-]+$/u.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' });
  }

  try {
    const filePath = path.join(LOCAL_TEMP_ROOT, 'inference', sessionId, 'final.wav');
    if (!isPathInside(filePath, path.join(LOCAL_TEMP_ROOT, 'inference')) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Result not ready or session not found' });
    }
    sendAudioFile(res, filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ref-audio', (req, res) => {
  const filePath = path.resolve(String(req.query.filePath || ''));
  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  const allowedRoots = [GPT_SOVITS_ROOT, LOCAL_TEMP_ROOT].filter(Boolean);
  const isAllowed = allowedRoots.some((root) => isPathInside(filePath, root));
  if (!isAllowed) {
    return res.status(400).json({ error: 'filePath is outside allowed audio roots' });
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.status(404).json({ error: 'Reference audio file not found' });
  }

  try {
    sendAudioFile(res, filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 4: Create `gpu-inference-worker/src/routes/activity.js`**

Inference-only variant — no training state imported.

```js
import { Router } from 'express';
import { buildActivityStatus, refreshActivityWhileBusy } from '../services/activityState.js';
import { inferenceState } from '../services/inferenceState.js';
import { hasActiveInferenceSession } from '../services/longTextInference.js';

const router = Router();

router.get('/activity/status', (_req, res) => {
  const inference = inferenceState.getState();
  const inferenceActive = hasActiveInferenceSession(inference.sessionId);
  const now = Date.now();

  res.json(buildActivityStatus({
    lastActivityAt: refreshActivityWhileBusy({
      inferenceActive,
      now,
    }),
    now,
    inferenceStatus: inference.status,
    inferenceActive,
  }));
});

export default router;
```

- [ ] **Step 5: Commit**

```
git add gpu-inference-worker/src/routes/
git commit -m "chore: add gpu-inference-worker routes"
```

---

### Task 6: Create gpu-inference-worker entry point and Dockerfile

**Files:**
- Create: `gpu-inference-worker/src/index.js`
- Create: `gpu-inference-worker/Dockerfile`
- Create: `docker/gpu-inference-worker/entrypoint.sh`

- [ ] **Step 1: Create `gpu-inference-worker/src/index.js`**

```js
import express from 'express';
import cors from 'cors';
import { WORKER_PORT, WORKER_HOST } from './config.js';
import inferenceRoutes from './routes/inference.js';
import modelsRoutes from './routes/models.js';
import artifactRoutes from './routes/artifacts.js';
import activityRoutes from './routes/activity.js';
import { inferenceServer } from './services/inferenceServer.js';
import { buildCorsOriginOption } from './services/corsOrigin.js';

const app = express();

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: buildCorsOriginOption(CORS_ORIGIN) }));
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'gpu-inference-worker', timestamp: Date.now() });
});

app.use('/', inferenceRoutes);
app.use('/', modelsRoutes);
app.use('/', artifactRoutes);
app.use('/', activityRoutes);

const server = app.listen(WORKER_PORT, WORKER_HOST, () => {
  console.log(`[gpu-inference-worker] Running on http://${WORKER_HOST}:${WORKER_PORT}`);
});

server.timeout = 0;
server.keepAliveTimeout = 0;

process.on('uncaughtException', (err) => console.error('[gpu-inference-worker] UNCAUGHT', err));
process.on('unhandledRejection', (r) => console.error('[gpu-inference-worker] UNHANDLED', r));

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[gpu-inference-worker] Received ${signal}, shutting down...`);
  inferenceServer.stop();
  server.close(() => { process.exit(0); });
  setTimeout(() => { process.exit(1); }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
```

- [ ] **Step 2: Create `docker/gpu-inference-worker/entrypoint.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV="${NODE_ENV:-production}"
export GPT_SOVITS_ROOT="${GPT_SOVITS_ROOT:-/opt/gpt-sovits}"
export PYTHON_EXEC="${PYTHON_EXEC:-$GPT_SOVITS_ROOT/venv/bin/python}"
export WORKER_HOST="${WORKER_HOST:-0.0.0.0}"
export WORKER_PORT="${WORKER_PORT:-3001}"
export INFERENCE_HOST="${INFERENCE_HOST:-127.0.0.1}"
export INFERENCE_PORT="${INFERENCE_PORT:-9880}"
export LOCAL_TEMP_ROOT="${LOCAL_TEMP_ROOT:-$GPT_SOVITS_ROOT/worker_temp}"

mkdir -p \
  "$LOCAL_TEMP_ROOT" \
  "$GPT_SOVITS_ROOT/GPT_weights_v2" \
  "$GPT_SOVITS_ROOT/SoVITS_weights_v2"

case "${1:-worker}" in
  worker|gpu-inference-worker)
    exec npm start
    ;;
  bash|sh)
    exec "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
```

- [ ] **Step 3: Create `gpu-inference-worker/Dockerfile`**

Nearly identical to `gpu-worker/Dockerfile` — same CUDA base, same Python/GPT-SoVITS setup, different app directory and entrypoint.

```dockerfile
# syntax=docker/dockerfile:1.7

FROM nvidia/cuda:11.8.0-cudnn8-devel-ubuntu22.04

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_MAJOR=20
ARG GPT_SOVITS_ARCHIVE=docker/vendor/GPT-SoVITS.zip

ENV NODE_ENV=production \
    WORKER_HOST=0.0.0.0 \
    WORKER_PORT=3001 \
    GPT_SOVITS_ROOT=/opt/gpt-sovits \
    PYTHON_EXEC=/opt/gpt-sovits/venv/bin/python \
    INFERENCE_HOST=127.0.0.1 \
    INFERENCE_PORT=9880 \
    LOCAL_TEMP_ROOT=/opt/gpt-sovits/worker_temp \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      ffmpeg \
      git \
      gnupg \
      libgl1 \
      libglib2.0-0 \
      libsndfile1 \
      libsm6 \
      libsox-dev \
      libxext6 \
      software-properties-common \
      unzip \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      python3.9 \
      python3.9-dev \
      python3.9-venv \
    && curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/gpu-inference-worker

COPY gpu-inference-worker/package*.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY gpu-inference-worker/ ./
COPY docker/gpu-inference-worker/entrypoint.sh /usr/local/bin/voice-gpu-inference-worker-entrypoint
COPY ${GPT_SOVITS_ARCHIVE} /tmp/GPT-SoVITS.zip

RUN mkdir -p "$GPT_SOVITS_ROOT" /tmp/gpt-sovits-unpack \
    && unzip -q /tmp/GPT-SoVITS.zip -d /tmp/gpt-sovits-unpack \
    && if [ -d /tmp/gpt-sovits-unpack/GPT-SoVITS ]; then \
         cp -a /tmp/gpt-sovits-unpack/GPT-SoVITS/. "$GPT_SOVITS_ROOT"/; \
       else \
         cp -a /tmp/gpt-sovits-unpack/. "$GPT_SOVITS_ROOT"/; \
       fi \
    && python3.9 -m venv "$GPT_SOVITS_ROOT/venv" \
    && "$PYTHON_EXEC" -m pip install --upgrade pip setuptools wheel \
    && "$PYTHON_EXEC" -m pip install \
      torch==2.1.1 \
      torchvision==0.16.1 \
      torchaudio==2.1.1 \
      --index-url https://download.pytorch.org/whl/cu118 \
    && "$PYTHON_EXEC" -m pip install -r "$GPT_SOVITS_ROOT/requirements.txt" \
    && "$PYTHON_EXEC" -m pip install "fastapi<0.112.2" "uvicorn[standard]" attrdict \
    && mkdir -p \
      "$LOCAL_TEMP_ROOT" \
      "$GPT_SOVITS_ROOT/GPT_weights_v2" \
      "$GPT_SOVITS_ROOT/SoVITS_weights_v2" \
    && chmod +x /usr/local/bin/voice-gpu-inference-worker-entrypoint \
    && rm -rf /tmp/GPT-SoVITS.zip /tmp/gpt-sovits-unpack /root/.cache/pip

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.WORKER_PORT || 3001) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["voice-gpu-inference-worker-entrypoint"]
CMD ["worker"]
```

- [ ] **Step 4: Commit**

```
git add gpu-inference-worker/src/index.js gpu-inference-worker/Dockerfile docker/gpu-inference-worker/
git commit -m "feat: add gpu-inference-worker entry point and Dockerfile"
```

---

### Task 7: Trim gpu-worker to training-only

**Files:**
- Modify: `gpu-worker/src/index.js`
- Modify: `gpu-worker/src/routes/artifacts.js`
- Modify: `gpu-worker/src/routes/activity.js`

- [ ] **Step 1: Update `gpu-worker/src/index.js`**

Remove the `inferenceRoutes` and `modelsRoutes` imports and `app.use()` calls. Keep training, transcribe, artifacts, and activity.

Replace the current content with:

```js
import express from 'express';
import cors from 'cors';
import { WORKER_PORT, WORKER_HOST } from './config.js';
import trainingRoutes from './routes/training.js';
import transcribeRoutes from './routes/transcribe.js';
import artifactRoutes from './routes/artifacts.js';
import activityRoutes from './routes/activity.js';
import { processManager } from './services/processManager.js';
import { recordTrainingLog } from './services/trainingLogger.js';
import { buildCorsOriginOption } from './services/corsOrigin.js';

const app = express();

processManager.on('log', ({ sessionId, stream, data }) => {
  recordTrainingLog(sessionId, { stream, data });
});
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: buildCorsOriginOption(CORS_ORIGIN) }));
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'gpu-worker', timestamp: Date.now() });
});

app.use('/', trainingRoutes);
app.use('/', transcribeRoutes);
app.use('/', artifactRoutes);
app.use('/', activityRoutes);

const server = app.listen(WORKER_PORT, WORKER_HOST, () => {
  console.log(`[gpu-worker] Running on http://${WORKER_HOST}:${WORKER_PORT}`);
});

server.timeout = 0;
server.keepAliveTimeout = 0;

process.on('uncaughtException', (err) => console.error('[gpu-worker] UNCAUGHT', err));
process.on('unhandledRejection', (r) => console.error('[gpu-worker] UNHANDLED', r));

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[gpu-worker] Received ${signal}, shutting down...`);
  server.close(() => { process.exit(0); });
  setTimeout(() => { process.exit(1); }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
```

- [ ] **Step 2: Update `gpu-worker/src/routes/artifacts.js`**

Remove the `/inference/result/:sessionId` and `/ref-audio` routes — leave only the training audio routes.

Replace the content of `gpu-worker/src/routes/artifacts.js` with:

```js
import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { GPT_SOVITS_ROOT, LOCAL_TEMP_ROOT } from '../config.js';
import { isPathInside, isSafePathSegment } from '../utils/paths.js';

const router = Router();
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.webm', '.mp4']);

function audioContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.mp4') return 'audio/mp4';
  return 'application/octet-stream';
}

function sendAudioFile(res, filePath) {
  const stat = fs.statSync(filePath);
  res.set({
    'Content-Type': audioContentType(filePath),
    'Content-Length': stat.size,
  });
  res.sendFile(filePath);
}

function expDataDirs(expName) {
  return [
    path.join(GPT_SOVITS_ROOT, 'data', expName),
    path.join(LOCAL_TEMP_ROOT, expName, 'data'),
  ];
}

function readTranscriptMap(asrDir) {
  const transcriptMap = new Map();
  if (!fs.existsSync(asrDir)) return transcriptMap;

  const listFile = fs.readdirSync(asrDir)
    .filter((filename) => filename.toLowerCase().endsWith('.list'))
    .sort()[0];
  if (!listFile) return transcriptMap;

  const content = fs.readFileSync(path.join(asrDir, listFile), 'utf-8');
  for (const line of content.split(/\r?\n/u).filter(Boolean)) {
    const parts = line.split('|');
    if (parts.length >= 4) {
      const filename = parts[0].replace(/\\/gu, '/').split('/').pop();
      transcriptMap.set(filename, {
        transcript: parts.slice(3).join('|'),
        lang: parts[2],
      });
    }
  }
  return transcriptMap;
}

function listTrainingAudio(expName) {
  const files = new Map();

  for (const dataDir of expDataDirs(expName)) {
    const denoisedDir = path.join(dataDir, 'denoised');
    if (!fs.existsSync(denoisedDir)) continue;

    const transcriptMap = readTranscriptMap(path.join(dataDir, 'asr'));
    for (const filename of fs.readdirSync(denoisedDir).sort()) {
      const filePath = path.join(denoisedDir, filename);
      const ext = path.extname(filename).toLowerCase();
      if (!fs.statSync(filePath).isFile() || !AUDIO_EXTENSIONS.has(ext)) continue;
      if (files.has(filename)) continue;

      const transcript = transcriptMap.get(filename) || {};
      files.set(filename, {
        filename,
        key: filePath,
        path: filePath,
        transcript: transcript.transcript || '',
        lang: transcript.lang || '',
        source: 'gpu-worker',
      });
    }
  }

  return [...files.values()];
}

function findTrainingAudioFile(expName, filename) {
  if (!isSafePathSegment(expName) || !isSafePathSegment(filename)) return null;

  for (const dataDir of expDataDirs(expName)) {
    const denoisedDir = path.join(dataDir, 'denoised');
    const filePath = path.join(denoisedDir, filename);
    if (isPathInside(filePath, denoisedDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return filePath;
    }
  }
  return null;
}

router.get('/training-audio/:expName', (req, res) => {
  const { expName } = req.params;
  if (!isSafePathSegment(expName)) {
    return res.status(400).json({ error: 'Invalid experiment name' });
  }

  try {
    res.json({ expName, files: listTrainingAudio(expName) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/training-audio/file/:expName/:filename', (req, res) => {
  try {
    const filePath = findTrainingAudioFile(req.params.expName, req.params.filename);
    if (!filePath) {
      return res.status(404).json({ error: 'Training audio file not found' });
    }
    sendAudioFile(res, filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 3: Update `gpu-worker/src/routes/activity.js`**

Remove inference state — report training-only activity.

```js
import { Router } from 'express';
import { buildActivityStatus, refreshActivityWhileBusy } from '../services/activityState.js';
import { processManager } from '../services/processManager.js';
import { trainingState } from '../services/trainingState.js';

const router = Router();

router.get('/activity/status', (_req, res) => {
  const training = trainingState.getState();
  const trainingActive = processManager.hasRunningProcesses();
  const now = Date.now();

  res.json(buildActivityStatus({
    lastActivityAt: refreshActivityWhileBusy({
      trainingActive,
      now,
    }),
    now,
    trainingStatus: training.status,
    trainingActive,
  }));
});

export default router;
```

- [ ] **Step 4: Verify gpu-worker still starts (no import errors)**

```
cd gpu-worker && node --input-type=module <<'EOF'
import './src/index.js';
EOF
```

Expected: server logs appear, no `Cannot find module` errors. (Ctrl+C to stop.)

- [ ] **Step 5: Commit**

```
git add gpu-worker/src/index.js gpu-worker/src/routes/artifacts.js gpu-worker/src/routes/activity.js
git commit -m "refactor: trim gpu-worker to training-only routes"
```

---

### Task 8: Update Lambda to support two worker URLs

**Files:**
- Modify: `lambda/shared/gpuWorker.js`
- Modify: `lambda/inference/index.js`
- Modify: `lambda/models/index.js`

- [ ] **Step 1: Update `lambda/shared/gpuWorker.js`**

Add `inferenceBaseUrl()` that reads `INFERENCE_WORKER_URL` and falls back to `GPU_WORKER_URL`. Add `inferencePost`, `inferenceGet`, `inferencePostBinary`, and `inferencePublicUrl` helpers. Existing `gpuPost`/`gpuGet` (used by training routes) are unchanged.

Replace `lambda/shared/gpuWorker.js` with:

```js
function baseUrl() {
  const GPU_WORKER_URL = process.env.GPU_WORKER_URL || '';
  if (!GPU_WORKER_URL) {
    throw new Error('GPU_WORKER_URL env var is not set');
  }
  return GPU_WORKER_URL.replace(/\/+$/u, '');
}

function publicBaseUrl() {
  const url = process.env.GPU_WORKER_PUBLIC_URL || process.env.GPU_WORKER_URL || '';
  if (!url) {
    throw new Error('GPU_WORKER_PUBLIC_URL or GPU_WORKER_URL env var is not set');
  }
  return url.replace(/\/+$/u, '');
}

function inferenceBaseUrl() {
  const url = process.env.INFERENCE_WORKER_URL || process.env.GPU_WORKER_URL || '';
  if (!url) {
    throw new Error('GPU_WORKER_URL env var is not set');
  }
  return url.replace(/\/+$/u, '');
}

function inferencePublicBaseUrl() {
  const url = process.env.INFERENCE_WORKER_PUBLIC_URL
    || process.env.INFERENCE_WORKER_URL
    || process.env.GPU_WORKER_PUBLIC_URL
    || process.env.GPU_WORKER_URL
    || '';
  if (!url) {
    throw new Error('No inference worker public URL configured');
  }
  return url.replace(/\/+$/u, '');
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export async function gpuPost(routePath, body = {}) {
  const response = await fetch(`${baseUrl()}${routePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await parseResponse(response);
  if (!response.ok) {
    throw new Error(data.error || data.message || `GPU Worker POST ${routePath} failed (${response.status})`);
  }
  return data;
}

export async function gpuGet(routePath) {
  const response = await fetch(`${baseUrl()}${routePath}`);
  const data = await parseResponse(response);
  if (!response.ok) {
    throw new Error(data.error || data.message || `GPU Worker GET ${routePath} failed (${response.status})`);
  }
  return data;
}

export function gpuPublicUrl(routePath) {
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${publicBaseUrl()}${normalizedPath}`;
}

export async function gpuPostBinary(routePath, body = {}) {
  const response = await fetch(`${baseUrl()}${routePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await parseResponse(response);
    throw new Error(data.error || data.message || `GPU Worker POST ${routePath} failed (${response.status})`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}

export async function inferencePost(routePath, body = {}) {
  const response = await fetch(`${inferenceBaseUrl()}${routePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await parseResponse(response);
  if (!response.ok) {
    throw new Error(data.error || data.message || `Inference Worker POST ${routePath} failed (${response.status})`);
  }
  return data;
}

export async function inferenceGet(routePath) {
  const response = await fetch(`${inferenceBaseUrl()}${routePath}`);
  const data = await parseResponse(response);
  if (!response.ok) {
    throw new Error(data.error || data.message || `Inference Worker GET ${routePath} failed (${response.status})`);
  }
  return data;
}

export function inferencePublicUrl(routePath) {
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${inferencePublicBaseUrl()}${normalizedPath}`;
}

export async function inferencePostBinary(routePath, body = {}) {
  const response = await fetch(`${inferenceBaseUrl()}${routePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await parseResponse(response);
    throw new Error(data.error || data.message || `Inference Worker POST ${routePath} failed (${response.status})`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}
```

- [ ] **Step 2: Update `lambda/inference/index.js`**

Replace every `gpuPost`, `gpuGet`, `gpuPostBinary`, `gpuPublicUrl` call with the `inference*` variants. The import line changes too.

Replace `lambda/inference/index.js` with:

```js
import { generatePresignedGetUrl } from '../shared/s3.js';
import { inferencePost, inferenceGet, inferencePostBinary, inferencePublicUrl } from '../shared/gpuWorker.js';
import { useGpuWorkerArtifacts } from '../shared/artifacts.js';
import { corsHeaders, ok, err, preflight, parseJsonBody } from '../shared/cors.js';

function isWorkerUnavailableError(error) {
  const message = error?.message || '';
  return error instanceof TypeError
    || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|GPU_WORKER_URL env var|INFERENCE_WORKER_URL/u.test(message);
}

function binaryWav(buffer, contentType = 'audio/wav') {
  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      ...corsHeaders,
    },
    body: buffer.toString('base64'),
  };
}

export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return preflight();
  }

  const method = event.requestContext?.http?.method;
  const routePath = event.rawPath || '';
  let body = {};
  if (method === 'POST') {
    try {
      body = parseJsonBody(event);
    } catch {
      return err(400, 'Invalid JSON body');
    }
  }

  try {
    if (method === 'POST' && routePath.endsWith('/inference')) {
      if (!body.text) return err(400, 'text is required');
      if (!body.ref_audio_path) return err(400, 'ref_audio_path is required');
      const { buffer, contentType } = await inferencePostBinary('/inference', body);
      return binaryWav(buffer, contentType);
    }

    if (method === 'POST' && routePath.endsWith('/inference/generate')) {
      if (!body.text) return err(400, 'text is required');
      if (!body.ref_audio_path) return err(400, 'ref_audio_path is required');
      return ok(await inferencePost('/inference/generate', body));
    }

    if (method === 'GET' && routePath.includes('/inference/result/')) {
      const sessionId = routePath.split('/inference/result/')[1]?.replace(/\/$/u, '');
      if (!sessionId || !/^[A-Za-z0-9-]+$/u.test(sessionId)) {
        return err(400, 'Invalid sessionId');
      }
      if (useGpuWorkerArtifacts()) {
        return ok({ url: inferencePublicUrl(`/inference/result/${encodeURIComponent(sessionId)}`) });
      }
      const url = await generatePresignedGetUrl(`audio/output/${sessionId}/final.wav`);
      return ok({ url });
    }

    if (method === 'POST' && routePath.endsWith('/inference/cancel')) {
      const { sessionId } = body;
      if (!sessionId) return err(400, 'sessionId is required');
      return ok(await inferencePost('/inference/cancel', { sessionId }));
    }

    if (method === 'POST' && routePath.endsWith('/inference/stop')) {
      return ok(await inferencePost('/inference/stop', {}));
    }

    if (method === 'GET' && routePath.endsWith('/inference/current')) {
      try {
        return ok(await inferenceGet('/inference/current'));
      } catch (error) {
        if (!isWorkerUnavailableError(error)) throw error;
        return ok({
          sessionId: null,
          status: 'idle',
          workerAvailable: false,
          message: error.message,
        });
      }
    }

    if (method === 'GET' && routePath.endsWith('/inference/status')) {
      return ok(await inferenceGet('/inference/status'));
    }

    return err(404, 'Not found');
  } catch (error) {
    return err(500, error.message);
  }
};
```

- [ ] **Step 3: Update `lambda/models/index.js`**

Model listing and weight loading both go to the inference worker (since weights live on the inference container). The `/models/download` call also goes to the inference worker.

Replace `lambda/models/index.js` with:

```js
import path from 'path';
import { listObjects } from '../shared/s3.js';
import { inferencePost, inferenceGet } from '../shared/gpuWorker.js';
import { ok, err, preflight, parseJsonBody } from '../shared/cors.js';

function modelSource() {
  return (process.env.MODEL_SOURCE || 's3').trim().toLowerCase();
}

function useGpuWorkerModels() {
  return ['gpu-worker', 'gpu', 'local', 'gpt-sovits'].includes(modelSource());
}

function isWorkerUnavailableError(error) {
  const message = error?.message || '';
  return error instanceof TypeError
    || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|GPU_WORKER_URL env var|INFERENCE_WORKER_URL/u.test(message);
}

export function toModelSummary(object) {
  const lastModified = object.lastModified instanceof Date
    ? object.lastModified.toISOString()
    : object.lastModified || null;
  const mtimeMs = object.lastModified instanceof Date
    ? object.lastModified.getTime()
    : Date.parse(object.lastModified || '');

  return {
    name: path.basename(object.key),
    key: object.key,
    path: object.key,
    ...(typeof object.size === 'number' ? { size: object.size } : {}),
    ...(lastModified ? { lastModified } : {}),
    ...(Number.isFinite(mtimeMs) ? { mtimeMs } : {}),
  };
}

export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return preflight();
  }

  const method = event.requestContext?.http?.method;
  const routePath = event.rawPath || '';

  try {
    if (method === 'GET' && routePath.endsWith('/models')) {
      if (useGpuWorkerModels()) {
        try {
          return ok(await inferenceGet('/models'));
        } catch (error) {
          if (!isWorkerUnavailableError(error)) throw error;
          return ok({
            gpt: [],
            sovits: [],
            workerAvailable: false,
            message: error.message,
          });
        }
      }

      const [gptObjects, sovitsObjects] = await Promise.all([
        listObjects('models/user-models/gpt/'),
        listObjects('models/user-models/sovits/'),
      ]);
      const gpt = gptObjects
        .filter((object) => object.key.endsWith('.ckpt'))
        .map(toModelSummary);
      const sovits = sovitsObjects
        .filter((object) => object.key.endsWith('.pth'))
        .map(toModelSummary);
      return ok({ gpt, sovits });
    }

    if (method === 'POST' && routePath.endsWith('/models/select')) {
      let body;
      try {
        body = parseJsonBody(event);
      } catch {
        return err(400, 'Invalid JSON body');
      }

      const resolvedGptKey = body.gptKey || body.gptPath;
      const resolvedSovitsKey = body.sovitsKey || body.sovitsPath;

      let lastStatus = null;
      if (useGpuWorkerModels()) {
        if (resolvedSovitsKey) {
          lastStatus = await inferencePost('/inference/weights/sovits', { weightsPath: resolvedSovitsKey });
        }
        if (resolvedGptKey) {
          lastStatus = await inferencePost('/inference/weights/gpt', { weightsPath: resolvedGptKey });
        }
        return ok({
          message: 'Models loaded successfully',
          loaded: lastStatus?.loaded || {},
        });
      }

      if (resolvedSovitsKey) {
        const { localPath } = await inferencePost('/models/download', { s3Key: resolvedSovitsKey });
        lastStatus = await inferencePost('/inference/weights/sovits', { weightsPath: localPath });
      }
      if (resolvedGptKey) {
        const { localPath } = await inferencePost('/models/download', { s3Key: resolvedGptKey });
        lastStatus = await inferencePost('/inference/weights/gpt', { weightsPath: localPath });
      }

      return ok({
        message: 'Models loaded successfully',
        loaded: lastStatus?.loaded || {},
      });
    }

    return err(404, 'Not found');
  } catch (error) {
    return err(500, error.message);
  }
};
```

- [ ] **Step 4: Commit**

```
git add lambda/shared/gpuWorker.js lambda/inference/index.js lambda/models/index.js
git commit -m "feat: route inference and model calls to separate inference worker"
```

---

### Task 9: Final verification and push

- [ ] **Step 1: Verify gpu-inference-worker directory is complete**

Run:
```
node -e "import('./gpu-inference-worker/src/index.js').catch(e => { console.error(e.message); process.exit(1); })"
```

Expected: Either starts (if GPT_SOVITS_ROOT is set) or logs a warning about missing root — but no `Cannot find module` errors.

- [ ] **Step 2: Check the root Dockerfile stub is updated**

Open `Dockerfile` (root). It currently lists build instructions. Add the inference worker to the list:

```
  docker build -f gpu-inference-worker/Dockerfile -t voice-gpu-inference-worker .
```

- [ ] **Step 3: Final commit**

```
git add .
git commit -m "feat: split gpu-worker into separate training and inference containers"
```

---

## Notes for Deployment

When you're ready to actually use the inference container in production:

1. Build and deploy `gpu-inference-worker` to a new EC2 (or same EC2 in a separate container)
2. Set `INFERENCE_WORKER_URL=http://<inference-ec2-ip>:3001` in the Lambda env vars
3. The training container (`GPU_WORKER_URL`) stays on the existing EC2 and handles training only

Until `INFERENCE_WORKER_URL` is set, all calls fall back to `GPU_WORKER_URL` — the live site keeps working on the current single-worker setup throughout this whole change.
