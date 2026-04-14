# S3 Storage Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all file operations from local filesystem to AWS S3 with presigned URLs, and create a GPU Worker API for remote training orchestration — while preserving full backward compatibility via a `STORAGE_MODE` toggle.

**Architecture:** A `STORAGE_MODE` env var (`local` | `s3`) branches every file operation. In `s3` mode, browser uploads/downloads go directly to S3 via presigned URLs. Training is delegated to a GPU Worker API running on the GPU instance, which syncs data to/from S3 and runs the Python pipeline locally. The backend acts as an orchestrator — generating presigned URLs, relaying SSE progress, and proxying inference results.

**Tech Stack:** Node.js/Express (ESM), AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`), React/Vite frontend, axios

**Spec:** `docs/superpowers/specs/2026-04-14-s3-storage-integration-design.md`

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `server/src/services/s3Storage.js` | S3 client wrapper — presigned URLs, upload, download, list, delete |
| `server/src/services/gpuWorkerClient.js` | HTTP client for GPU Worker API — training, transcription, model download |
| `gpu-worker/package.json` | GPU Worker project config |
| `gpu-worker/src/index.js` | GPU Worker Express server entry point |
| `gpu-worker/src/config.js` | GPU Worker env config (GPT_SOVITS_ROOT, S3, etc.) |
| `gpu-worker/src/routes/training.js` | Training start/stop/progress endpoints |
| `gpu-worker/src/routes/models.js` | Model download from S3 to local cache |
| `gpu-worker/src/routes/transcribe.js` | Whisper transcription endpoint |
| `gpu-worker/src/services/s3Sync.js` | S3 download/upload directory sync |
| `gpu-worker/src/services/pipeline.js` | Training pipeline (adapted from server) |
| `gpu-worker/src/services/processManager.js` | Python process spawning (copied from server) |
| `gpu-worker/src/services/sseManager.js` | SSE for progress streaming (copied from server) |
| `gpu-worker/src/services/configGenerator.js` | Training config generation (copied from server) |
| `gpu-worker/src/services/trainingState.js` | Training state tracking (copied from server) |
| `gpu-worker/src/services/trainingSteps.js` | Step names array (copied from server) |
| `gpu-worker/src/utils/paths.js` | Path utilities (copied from server) |

### Modified files

| File | Changes |
|---|---|
| `server/package.json` | Add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |
| `server/src/config.js` | Add `STORAGE_MODE`, `S3_BUCKET`, `S3_REGION`, `S3_PREFIX`, `GPU_WORKER_HOST`, `GPU_WORKER_PORT`, `isS3Mode()` |
| `server/src/index.js` | Add `GET /api/config` endpoint |
| `server/src/routes/upload.js` | Add presigned upload + confirm endpoints for S3 mode |
| `server/src/routes/inference.js` | Branch model listing, audio serving, inference result on storage mode |
| `server/src/routes/training.js` | Delegate to GPU Worker client in S3 mode |
| `client/src/services/api.js` | Add S3 upload/download flows, storage mode branching |
| `client/src/lib/runtimeConfig.js` | Add storage mode cache |
| `server/.env.example` | Add S3 + GPU Worker env vars |
| `client/.env.example` | Already has `VITE_API_BASE_URL` |
| `Dockerfile` | No changes needed (env vars configured at runtime) |

---

## Task 1: Install AWS SDK & Add S3 Config Vars

**Files:**
- Modify: `server/package.json`
- Modify: `server/src/config.js:48-141`

- [ ] **Step 1: Install AWS SDK packages**

```bash
cd server
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: Add S3 and GPU Worker config vars to `server/src/config.js`**

Add after line 140 (`const ALLOW_ALL_CORS = ...`), before `function buildPythonEnv`:

```javascript
const STORAGE_MODE = readEnv('STORAGE_MODE') || 'local';
const S3_BUCKET = readEnv('S3_BUCKET');
const S3_REGION = readEnv('S3_REGION');
const S3_PREFIX = readEnv('S3_PREFIX') || '';
const GPU_WORKER_HOST = readEnv('GPU_WORKER_HOST') || INFERENCE_HOST;
const GPU_WORKER_PORT = parseIntegerEnv(readEnv('GPU_WORKER_PORT'), 3001);

function isS3Mode() {
  return STORAGE_MODE === 's3';
}

if (isS3Mode()) {
  if (!S3_BUCKET) {
    console.warn('[config] STORAGE_MODE=s3 but S3_BUCKET is not set');
  }
  if (!S3_REGION) {
    console.warn('[config] STORAGE_MODE=s3 but S3_REGION is not set');
  }
  console.log(`Storage mode: s3 (bucket: ${S3_BUCKET}, region: ${S3_REGION}, prefix: "${S3_PREFIX}")`);
  console.log(`GPU Worker: ${GPU_WORKER_HOST}:${GPU_WORKER_PORT}`);
} else {
  console.log('Storage mode: local');
}
```

Add these to the export block:

```javascript
export {
  // ... existing exports ...
  STORAGE_MODE,
  S3_BUCKET,
  S3_REGION,
  S3_PREFIX,
  GPU_WORKER_HOST,
  GPU_WORKER_PORT,
  isS3Mode,
};
```

- [ ] **Step 3: Commit**

```bash
git add server/package.json server/package-lock.json server/src/config.js
git commit -m "feat: add AWS SDK deps and S3/GPU Worker config vars"
```

---

## Task 2: Create S3 Storage Service

**Files:**
- Create: `server/src/services/s3Storage.js`

- [ ] **Step 1: Create `server/src/services/s3Storage.js`**

```javascript
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3_BUCKET, S3_REGION, S3_PREFIX, isS3Mode } from '../config.js';

let client = null;

function getClient() {
  if (!client) {
    if (!S3_REGION) {
      throw new Error('S3_REGION is not configured');
    }
    client = new S3Client({ region: S3_REGION });
  }
  return client;
}

function fullKey(key) {
  const prefix = S3_PREFIX ? S3_PREFIX.replace(/\/+$/, '') + '/' : '';
  return prefix + key;
}

function stripPrefix(key) {
  const prefix = S3_PREFIX ? S3_PREFIX.replace(/\/+$/, '') + '/' : '';
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function requireBucket() {
  if (!S3_BUCKET) {
    throw new Error('S3_BUCKET is not configured');
  }
  return S3_BUCKET;
}

export async function generatePresignedPutUrl(key, contentType, expiresIn = 3600) {
  const bucket = requireBucket();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: fullKey(key),
    ContentType: contentType,
  });
  const url = await getSignedUrl(getClient(), command, { expiresIn });
  return { url, key };
}

export async function generatePresignedGetUrl(key, expiresIn = 3600) {
  const bucket = requireBucket();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: fullKey(key),
  });
  return getSignedUrl(getClient(), command, { expiresIn });
}

export async function uploadBuffer(key, buffer, contentType) {
  const bucket = requireBucket();
  await getClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: fullKey(key),
    Body: buffer,
    ContentType: contentType,
  }));
}

export async function downloadToFile(key, localPath) {
  const bucket = requireBucket();
  const response = await getClient().send(new GetObjectCommand({
    Bucket: bucket,
    Key: fullKey(key),
  }));
  const dir = path.dirname(localPath);
  fs.mkdirSync(dir, { recursive: true });
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  fs.writeFileSync(localPath, Buffer.concat(chunks));
}

export async function getObject(key) {
  const bucket = requireBucket();
  const response = await getClient().send(new GetObjectCommand({
    Bucket: bucket,
    Key: fullKey(key),
  }));
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function headObject(key) {
  const bucket = requireBucket();
  try {
    const response = await getClient().send(new HeadObjectCommand({
      Bucket: bucket,
      Key: fullKey(key),
    }));
    return { size: response.ContentLength, lastModified: response.LastModified };
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

export async function listObjects(prefix) {
  const bucket = requireBucket();
  const results = [];
  let continuationToken;
  do {
    const response = await getClient().send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: fullKey(prefix),
      ContinuationToken: continuationToken,
    }));
    if (response.Contents) {
      for (const obj of response.Contents) {
        results.push({
          key: stripPrefix(obj.Key),
          size: obj.Size,
          lastModified: obj.LastModified,
        });
      }
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return results;
}

export async function deleteObject(key) {
  const bucket = requireBucket();
  await getClient().send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: fullKey(key),
  }));
}

export async function deletePrefix(prefix) {
  const objects = await listObjects(prefix);
  for (const obj of objects) {
    await deleteObject(obj.key);
  }
}

export { isS3Mode };
```

- [ ] **Step 2: Verify the module imports cleanly**

```bash
cd server
node -e "import('./src/services/s3Storage.js').then(() => console.log('OK')).catch(e => console.error(e.message))"
```

Expected: `OK` (no S3 calls are made at import time)

- [ ] **Step 3: Commit**

```bash
git add server/src/services/s3Storage.js
git commit -m "feat: add S3 storage service with presigned URLs, upload, download, list"
```

---

## Task 3: Add Config Endpoint & Update .env.example

**Files:**
- Modify: `server/src/index.js:52-69`
- Modify: `server/.env.example`

- [ ] **Step 1: Add `GET /api/config` endpoint in `server/src/index.js`**

Add after the `/readyz` endpoint (after line 69), before the processManager event wiring:

```javascript
app.get('/api/config', (_req, res) => {
  res.json({
    storageMode: isS3Mode() ? 's3' : 'local',
  });
});
```

Add `isS3Mode` to the import from `./config.js`:

```javascript
import {
  SERVER_HOST,
  SERVER_PORT,
  TRUST_PROXY,
  SERVE_CLIENT_DIST,
  CLIENT_DIST_DIR,
  CORS_ORIGINS,
  ALLOW_ALL_CORS,
  ensureRuntimeDirectories,
  getConfigError,
  isS3Mode,
} from './config.js';
```

- [ ] **Step 2: Update `server/.env.example`**

Add at the end:

```env

# ── Storage mode ──
# STORAGE_MODE=s3

# ── S3 configuration (required when STORAGE_MODE=s3) ──
# S3_BUCKET=my-voice-cloning-bucket
# S3_REGION=ap-southeast-1
# S3_PREFIX=prod/

# ── GPU Worker (required when STORAGE_MODE=s3 and GPU is on a separate host) ──
# GPU_WORKER_HOST=10.0.2.25
# GPU_WORKER_PORT=3001
```

- [ ] **Step 3: Commit**

```bash
git add server/src/index.js server/.env.example
git commit -m "feat: add /api/config endpoint exposing storageMode"
```

---

## Task 4: Presigned Upload Endpoints (Training + Reference Audio)

**Files:**
- Modify: `server/src/routes/upload.js`

- [ ] **Step 1: Add presigned upload routes to `server/src/routes/upload.js`**

Add imports at top of file:

```javascript
import { isS3Mode, generatePresignedPutUrl, headObject } from '../services/s3Storage.js';
```

Add after the existing `router.post('/upload-ref', ...)` block (after line 77), before `export default router`:

```javascript
// ── S3 presigned upload endpoints ──

const ALLOWED_AUDIO_EXTS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a'];

router.post('/upload/presign', async (req, res) => {
  if (!isS3Mode()) {
    return res.status(400).json({ error: 'Presigned uploads only available in S3 mode' });
  }

  const { expName, files } = req.body;
  if (!expName) {
    return res.status(400).json({ error: 'expName is required' });
  }
  if (!isSafePathSegment(expName)) {
    return res.status(400).json({ error: 'expName contains unsupported characters' });
  }
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'files array is required' });
  }
  if (files.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 files per upload' });
  }

  try {
    const uploads = [];
    for (const file of files) {
      const ext = path.extname(file.name || '').toLowerCase();
      if (!ALLOWED_AUDIO_EXTS.includes(ext)) {
        return res.status(400).json({ error: `File "${file.name}" has unsupported extension "${ext}"` });
      }
      const safeName = sanitizeFilename(file.name, 'training-audio');
      const key = `training/datasets/${expName}/raw/${safeName}`;
      const contentType = file.type || 'audio/wav';
      const { url } = await generatePresignedPutUrl(key, contentType);
      uploads.push({ filename: safeName, url, key });
    }
    res.json({ uploads });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload/confirm', async (req, res) => {
  if (!isS3Mode()) {
    return res.status(400).json({ error: 'Only available in S3 mode' });
  }

  const { expName, keys } = req.body;
  if (!expName || !Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ error: 'expName and keys array are required' });
  }

  try {
    let confirmed = 0;
    const confirmedFiles = [];
    for (const key of keys) {
      const head = await headObject(key);
      if (head) {
        confirmed += 1;
        confirmedFiles.push(path.basename(key));
      }
    }
    res.json({ confirmed, files: confirmedFiles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload-ref/presign', async (req, res) => {
  if (!isS3Mode()) {
    return res.status(400).json({ error: 'Only available in S3 mode' });
  }

  const { filename, type } = req.body;
  if (!filename) {
    return res.status(400).json({ error: 'filename is required' });
  }

  try {
    const safeName = sanitizeFilename(filename, 'reference-audio');
    const key = `audio/reference/ref_${Date.now()}_${safeName}`;
    const contentType = type || 'audio/wav';
    const { url } = await generatePresignedPutUrl(key, contentType);
    res.json({ url, key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload-ref/confirm', async (req, res) => {
  if (!isS3Mode()) {
    return res.status(400).json({ error: 'Only available in S3 mode' });
  }

  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'key is required' });
  }

  try {
    const head = await headObject(key);
    if (!head) {
      return res.status(404).json({ error: 'File not found in S3' });
    }
    res.json({ key, filename: path.basename(key) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Verify server starts without errors**

```bash
cd server
node src/index.js
```

Expected: Server starts, logs `Storage mode: local`. Stop with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/upload.js
git commit -m "feat: add presigned S3 upload endpoints for training and reference audio"
```

---

## Task 5: S3 Mode for Training Audio Listing & File Serving

**Files:**
- Modify: `server/src/routes/inference.js:337-433`

- [ ] **Step 1: Add S3 imports to `server/src/routes/inference.js`**

Add to the existing imports at the top:

```javascript
import { isS3Mode, generatePresignedGetUrl, listObjects, getObject } from '../services/s3Storage.js';
```

- [ ] **Step 2: Update `GET /api/training-audio/:expName` to branch on storage mode**

Replace the existing handler (lines 386–433) with:

```javascript
router.get('/training-audio/:expName', async (req, res) => {
  const { expName } = req.params;
  if (!isSafePathSegment(expName)) {
    return res.status(400).json({ error: 'Invalid experiment name' });
  }

  if (isS3Mode()) {
    try {
      const denoisedPrefix = `training/datasets/${expName}/denoised/`;
      const objects = await listObjects(denoisedPrefix);
      const wavFiles = objects
        .filter(o => o.key.endsWith('.wav'))
        .map(o => path.basename(o.key))
        .sort();

      // Try to parse ASR transcript from S3
      const transcriptMap = new Map();
      try {
        const asrKey = `training/datasets/${expName}/asr/denoised.list`;
        const asrBuffer = await getObject(asrKey);
        const lines = asrBuffer.toString('utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
          const parts = line.split('|');
          if (parts.length >= 4) {
            const fname = path.basename(parts[0]);
            transcriptMap.set(fname, { transcript: parts.slice(3).join('|'), lang: parts[2] });
          }
        }
      } catch { /* ASR file may not exist yet */ }

      const files = wavFiles.map(filename => {
        const info = transcriptMap.get(filename) || {};
        return {
          filename,
          key: `${denoisedPrefix}${filename}`,
          transcript: info.transcript || '',
          lang: info.lang || '',
        };
      });
      return res.json({ expName, files });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode — original behavior
  if (!DATA_ROOT) {
    return res.status(503).json({ error: 'Training data directory is not configured' });
  }

  const denoisedDir = path.join(DATA_ROOT, expName, 'denoised');
  if (!fs.existsSync(denoisedDir)) {
    return res.json({ expName, files: [] });
  }

  const asrPath = path.join(DATA_ROOT, expName, 'asr', 'denoised.list');
  const transcriptMap = new Map();
  if (fs.existsSync(asrPath)) {
    const lines = fs.readFileSync(asrPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length >= 4) {
        const fname = path.basename(parts[0]);
        transcriptMap.set(fname, { transcript: parts.slice(3).join('|'), lang: parts[2] });
      }
    }
  }

  try {
    const wavFiles = fs.readdirSync(denoisedDir).filter(f => f.endsWith('.wav')).sort();
    const files = wavFiles.map(filename => {
      const info = transcriptMap.get(filename) || {};
      return {
        filename,
        path: path.join(denoisedDir, filename),
        transcript: info.transcript || '',
        lang: info.lang || '',
      };
    });
    res.json({ expName, files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Update `GET /api/training-audio/file/:expName/:filename` to branch on storage mode**

Replace the existing handler (lines 339–359) with:

```javascript
router.get('/training-audio/file/:expName/:filename', async (req, res) => {
  const { expName, filename } = req.params;
  if (!isSafePathSegment(expName) || !isSafePathSegment(filename)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  if (isS3Mode()) {
    try {
      const key = `training/datasets/${expName}/denoised/${filename}`;
      const url = await generatePresignedGetUrl(key);
      return res.json({ url });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode
  if (!DATA_ROOT) {
    return res.status(503).json({ error: 'Training data directory is not configured' });
  }
  const filePath = path.join(DATA_ROOT, expName, 'denoised', filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  const stat = fs.statSync(filePath);
  res.set({ 'Content-Type': 'audio/wav', 'Content-Length': stat.size });
  fs.createReadStream(filePath).pipe(res);
});
```

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/inference.js
git commit -m "feat: S3 mode for training audio listing and file serving"
```

---

## Task 6: S3 Mode for Reference Audio, Models, and Inference Result

**Files:**
- Modify: `server/src/routes/inference.js`

- [ ] **Step 1: Update `GET /api/ref-audio` to branch on storage mode**

Replace the existing handler (lines 361–384) with:

```javascript
router.get('/ref-audio', async (req, res) => {
  const filePath = String(req.query.filePath || '');
  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  if (isS3Mode()) {
    try {
      const url = await generatePresignedGetUrl(filePath);
      return res.json({ url });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode
  if (!REF_AUDIO_DIR) {
    return res.status(503).json({ error: 'Reference audio directory is not configured' });
  }
  const resolvedPath = path.resolve(GPT_SOVITS_ROOT, filePath);
  if (!isPathInside(resolvedPath, REF_AUDIO_DIR)) {
    return res.status(400).json({ error: 'Invalid reference audio path' });
  }
  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'Reference audio not found' });
  }
  const stat = fs.statSync(resolvedPath);
  res.type(path.extname(resolvedPath));
  res.set({ 'Content-Length': stat.size });
  fs.createReadStream(resolvedPath).pipe(res);
});
```

- [ ] **Step 2: Update `GET /api/models` to branch on storage mode**

Replace the existing handler (lines 15–37) with:

```javascript
router.get('/models', async (_req, res) => {
  if (isS3Mode()) {
    try {
      const [gptObjects, sovitsObjects] = await Promise.all([
        listObjects('models/user-models/gpt/'),
        listObjects('models/user-models/sovits/'),
      ]);
      const gpt = gptObjects
        .filter(o => o.key.endsWith('.ckpt'))
        .map(o => ({ name: path.basename(o.key), key: o.key }));
      const sovits = sovitsObjects
        .filter(o => o.key.endsWith('.pth'))
        .map(o => ({ name: path.basename(o.key), key: o.key }));
      return res.json({ gpt, sovits });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode
  const configError = getConfigError();
  if (configError) {
    return res.status(500).json({ error: configError });
  }
  try {
    const gptFiles = fs.existsSync(WEIGHT_DIRS.gpt)
      ? fs.readdirSync(WEIGHT_DIRS.gpt).filter(f => f.endsWith('.ckpt'))
      : [];
    const sovitsFiles = fs.existsSync(WEIGHT_DIRS.sovits)
      ? fs.readdirSync(WEIGHT_DIRS.sovits).filter(f => f.endsWith('.pth'))
      : [];
    res.json({
      gpt: gptFiles.map(f => ({ name: f, path: path.join(WEIGHT_DIRS.gpt, f) })),
      sovits: sovitsFiles.map(f => ({ name: f, path: path.join(WEIGHT_DIRS.sovits, f) })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Update `POST /api/models/select` for S3 mode**

Replace the existing handler (lines 39–65) with:

```javascript
router.post('/models/select', async (req, res) => {
  if (isS3Mode()) {
    const { gptKey, sovitsKey, gptPath, sovitsPath } = req.body;
    const resolvedGptKey = gptKey || gptPath;
    const resolvedSovitsKey = sovitsKey || sovitsPath;

    try {
      if (!inferenceServer.isReady()) {
        await inferenceServer.start();
      }

      // In S3 mode, download weights via GPU Worker, then load
      const { gpuWorkerClient } = await import('../services/gpuWorkerClient.js');

      if (resolvedSovitsKey) {
        const { localPath } = await gpuWorkerClient.downloadModel(resolvedSovitsKey);
        await inferenceServer.setSoVITSWeights(localPath);
      }
      if (resolvedGptKey) {
        const { localPath } = await gpuWorkerClient.downloadModel(resolvedGptKey);
        await inferenceServer.setGPTWeights(localPath);
      }

      return res.json({
        message: 'Models loaded successfully',
        loaded: inferenceServer.getLoadedWeights(),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode
  const { gptPath, sovitsPath } = req.body;
  const configError = getConfigError({ requirePython: true });
  if (configError) {
    return res.status(500).json({ error: configError });
  }
  try {
    if (!inferenceServer.isReady()) {
      await inferenceServer.start();
    }
    if (sovitsPath) {
      await inferenceServer.setSoVITSWeights(sovitsPath);
    }
    if (gptPath) {
      await inferenceServer.setGPTWeights(gptPath);
    }
    res.json({
      message: 'Models loaded successfully',
      loaded: inferenceServer.getLoadedWeights(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Update `GET /api/inference/result/:sessionId` for S3 mode**

Replace the existing handler (lines 220–232) with:

```javascript
router.get('/inference/result/:sessionId', async (req, res) => {
  if (isS3Mode()) {
    try {
      const key = `audio/output/${req.params.sessionId}/final.wav`;
      const url = await generatePresignedGetUrl(key);
      return res.json({ url });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode
  const finalPath = getSessionFinalPath(req.params.sessionId);
  if (!fs.existsSync(finalPath)) {
    return res.status(404).json({ error: 'Result not ready or session not found' });
  }
  const stat = fs.statSync(finalPath);
  res.set({ 'Content-Type': 'audio/wav', 'Content-Length': stat.size });
  fs.createReadStream(finalPath).pipe(res);
});
```

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/inference.js
git commit -m "feat: S3 mode for ref audio, model listing/selection, inference result"
```

---

## Task 7: S3 Dual Delivery for Inference Output

**Files:**
- Modify: `server/src/services/longTextInference.js:970-1095`

- [ ] **Step 1: Add S3 upload after inference completes in streaming mode**

Add import at the top of `server/src/services/longTextInference.js`:

```javascript
import { isS3Mode, uploadBuffer } from './s3Storage.js';
```

In the `synthesizeLongTextStreaming` function, after `fs.writeFileSync(finalPath, finalBuffer)` (around line 1075) and before the cleanup of chunk files, add:

```javascript
    // Upload to S3 for persistence (non-blocking — don't fail the session on S3 error)
    let s3Key = null;
    if (isS3Mode()) {
      s3Key = `audio/output/${sessionId}/final.wav`;
      uploadBuffer(s3Key, finalBuffer, 'audio/wav').catch((err) => {
        console.error(`[inference] Failed to upload result to S3: ${err.message}`);
      });
    }
```

Update the `inference-complete` SSE event to include the S3 key:

```javascript
    sseManager.send(sessionId, 'inference-complete', {
      totalChunks: chunks.length,
      totalDurationSec: parseFloat(totalDuration.toFixed(2)),
      ...(s3Key ? { s3Key } : {}),
    });
```

- [ ] **Step 2: No changes needed for synchronous `synthesizeLongText`**

The synchronous `POST /api/inference` endpoint returns the WAV buffer directly to the client. There is no session ID to associate with S3 storage, and the client already has the audio data. S3 persistence only applies to the streaming path (which has a session ID and a `GET /inference/result/:sessionId` endpoint for later retrieval). Skip this — no code change needed.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/longTextInference.js
git commit -m "feat: upload inference output to S3 in parallel (dual delivery)"
```

---

## Task 8: S3 Mode for Transcription

**Files:**
- Modify: `server/src/routes/inference.js:256-326`

- [ ] **Step 1: Update `POST /api/transcribe` to branch on storage mode**

Replace the existing handler (lines 256–326) with:

```javascript
router.post('/transcribe', async (req, res) => {
  const { filePath, language = 'auto' } = req.body;
  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  if (isS3Mode()) {
    try {
      const { gpuWorkerClient } = await import('../services/gpuWorkerClient.js');
      const result = await gpuWorkerClient.transcribe(filePath, language);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode
  const configError = getConfigError({ requirePython: true });
  if (configError) {
    return res.status(503).json({ error: configError });
  }

  const absolutePath = path.resolve(GPT_SOVITS_ROOT, filePath);
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ error: 'Audio file not found' });
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const args = [
        '-c',
        [
          'import runpy, sys',
          `ROOT = ${JSON.stringify(GPT_SOVITS_ROOT)}`,
          `TOOLS = ROOT + "/tools"`,
          `GPT = ROOT + "/GPT_SoVITS"`,
          `SCRIPT = ${JSON.stringify(SCRIPTS.transcribeSingle)}`,
          'sys.path[:0] = [path for path in (GPT, TOOLS, ROOT) if path and path not in sys.path]',
          'sys.argv = [SCRIPT, *sys.argv[1:]]',
          'runpy.run_path(SCRIPT, run_name="__main__")',
        ].join('; '),
        '-i', absolutePath,
        '-l', language,
        '-s', 'medium',
        '-p', 'int8',
      ];

      const proc = spawn(PYTHON_EXEC, args, {
        cwd: GPT_SOVITS_ROOT,
        env: buildPythonEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
        console.log('[transcribe]', d.toString().trim());
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(stderr || `Transcription exited with code ${code}`));
        }
        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        try {
          resolve(JSON.parse(lastLine));
        } catch {
          reject(new Error('Failed to parse transcription output'));
        }
      });

      proc.on('error', reject);
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/inference.js
git commit -m "feat: delegate transcription to GPU Worker in S3 mode"
```

---

## Task 9: S3 Mode for Training Route

**Files:**
- Modify: `server/src/routes/training.js`

- [ ] **Step 1: Update training route to delegate to GPU Worker in S3 mode**

Replace the full content of `server/src/routes/training.js`:

```javascript
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sseManager } from '../services/sseManager.js';
import { processManager } from '../services/processManager.js';
import { runPipeline, STEPS } from '../services/pipeline.js';
import { getConfigError, isS3Mode, S3_BUCKET, S3_PREFIX } from '../config.js';
import { trainingState } from '../services/trainingState.js';
import { isSafePathSegment } from '../utils/paths.js';

const router = Router();

const sessions = new Map();

router.post('/train', async (req, res) => {
  const {
    expName,
    batchSize,
    sovitsEpochs,
    gptEpochs,
    sovitsSaveEvery,
    gptSaveEvery,
    asrLanguage,
    asrModel,
  } = req.body;

  if (!expName) {
    return res.status(400).json({ error: 'expName is required' });
  }
  if (!isSafePathSegment(expName)) {
    return res.status(400).json({ error: 'expName may only contain letters, numbers, dots, dashes, and underscores' });
  }

  if (isS3Mode()) {
    try {
      const { gpuWorkerClient } = await import('../services/gpuWorkerClient.js');

      const sessionId = uuidv4();
      sessions.set(sessionId, { expName, startedAt: Date.now() });
      trainingState.resetForNewSession({ sessionId, expName });
      sseManager.prepareSession(sessionId);

      // Start training on GPU Worker
      const workerSessionId = await gpuWorkerClient.startTraining({
        expName,
        s3Bucket: S3_BUCKET,
        s3Prefix: S3_PREFIX,
        config: {
          batchSize,
          sovitsEpochs,
          gptEpochs,
          sovitsSaveEvery,
          gptSaveEvery,
          asrLanguage,
          asrModel,
        },
      });

      res.json({ sessionId, steps: STEPS });

      // Wait for SSE client, then relay GPU Worker events
      sseManager.waitForClient(sessionId).then(() => {
        trainingState.setStatus('running');
        return gpuWorkerClient.relayProgress(workerSessionId, sessionId, sseManager, trainingState);
      }).catch((err) => {
        trainingState.setError(err.message || 'Failed to connect to GPU Worker');
        sseManager.send(sessionId, 'error', {
          message: err.message || 'Failed to connect to GPU Worker',
        });
      }).finally(() => {
        sessions.delete(sessionId);
      });

      return;
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode — original behavior
  const configError = getConfigError({ requirePython: true });
  if (configError) {
    return res.status(503).json({ error: configError });
  }

  if (sessions.size > 0 || processManager.hasRunningProcesses()) {
    return res.status(409).json({ error: 'A training pipeline is already running on this instance' });
  }

  const sessionId = uuidv4();
  sessions.set(sessionId, { expName, startedAt: Date.now() });
  trainingState.resetForNewSession({ sessionId, expName });
  sseManager.prepareSession(sessionId);

  sseManager.waitForClient(sessionId).then(() => {
    trainingState.setStatus('running');
    return runPipeline(sessionId, {
      expName,
      batchSize,
      sovitsEpochs,
      gptEpochs,
      sovitsSaveEvery,
      gptSaveEvery,
      asrLanguage,
      asrModel,
    });
  }).catch((err) => {
    trainingState.setError(err.message || 'Pipeline failed to start');
    sseManager.send(sessionId, 'error', {
      message: err.message || 'Pipeline failed to start',
    });
  }).finally(() => {
    sessions.delete(sessionId);
  });

  res.json({ sessionId, steps: STEPS });
});

router.get('/train/current', (_req, res) => {
  res.json(trainingState.getState());
});

router.get('/train/status/:sessionId', (req, res) => {
  sseManager.addClient(req.params.sessionId, res);
});

router.post('/train/stop', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  if (isS3Mode()) {
    try {
      const { gpuWorkerClient } = await import('../services/gpuWorkerClient.js');
      await gpuWorkerClient.stopTraining(sessionId);
      trainingState.setStatus('stopped');
      sseManager.send(sessionId, 'error', { message: 'Training stopped by user' });
      sessions.delete(sessionId);
      return res.json({ message: 'Training stopped' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local mode
  const killed = processManager.kill(sessionId);
  if (killed) {
    trainingState.setStatus('stopped');
    sseManager.send(sessionId, 'error', { message: 'Training stopped by user' });
    sessions.delete(sessionId);
    res.json({ message: 'Training stopped' });
  } else {
    res.status(404).json({ error: 'No running process found for this session' });
  }
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/training.js
git commit -m "feat: delegate training to GPU Worker in S3 mode"
```

---

## Task 10: Create GPU Worker Client

**Files:**
- Create: `server/src/services/gpuWorkerClient.js`

- [ ] **Step 1: Create `server/src/services/gpuWorkerClient.js`**

```javascript
import axios from 'axios';
import { GPU_WORKER_HOST, GPU_WORKER_PORT } from '../config.js';

function getBaseUrl() {
  return `http://${GPU_WORKER_HOST}:${GPU_WORKER_PORT}`;
}

const client = axios.create({ timeout: 300_000 });

export const gpuWorkerClient = {
  async startTraining(params) {
    const res = await client.post(`${getBaseUrl()}/train`, params);
    return res.data.sessionId;
  },

  async stopTraining(sessionId) {
    await client.post(`${getBaseUrl()}/train/stop`, { sessionId });
  },

  async relayProgress(workerSessionId, localSessionId, sseManager, trainingState) {
    return new Promise((resolve, reject) => {
      const url = `${getBaseUrl()}/train/progress/${workerSessionId}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('GPU Worker progress stream timed out'));
      }, 24 * 60 * 60 * 1000); // 24h max training time

      fetch(url, { signal: controller.signal }).then(async (response) => {
        if (!response.ok) {
          clearTimeout(timeout);
          reject(new Error(`GPU Worker returned ${response.status}`));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6));
                sseManager.send(localSessionId, currentEvent, data);

                // Update training state based on event
                if (currentEvent === 'step-start') {
                  trainingState.setStepStatus(data.step, data.status, data.detail || '');
                } else if (currentEvent === 'step-complete') {
                  trainingState.setStepStatus(data.step, data.code === 0 ? 'done' : 'error');
                } else if (currentEvent === 'log') {
                  trainingState.appendLog(data);
                } else if (currentEvent === 'pipeline-complete') {
                  trainingState.setStatus('complete');
                } else if (currentEvent === 'error') {
                  trainingState.setError(data.message);
                }
              } catch { /* skip malformed data */ }
              currentEvent = '';
            }
          }
        }

        clearTimeout(timeout);
        resolve();
      }).catch((err) => {
        clearTimeout(timeout);
        if (err.name === 'AbortError') return;
        reject(err);
      });
    });
  },

  async transcribe(s3Key, language = 'auto') {
    const res = await client.post(`${getBaseUrl()}/transcribe`, { s3Key, language });
    return res.data;
  },

  async downloadModel(s3Key) {
    const res = await client.post(`${getBaseUrl()}/models/download`, { s3Key });
    return res.data;
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/gpuWorkerClient.js
git commit -m "feat: add GPU Worker client for training, transcription, model download"
```

---

## Task 11: Frontend — Storage Mode Detection & S3 Upload Flows

**Files:**
- Modify: `client/src/lib/runtimeConfig.js`
- Modify: `client/src/services/api.js`

- [ ] **Step 1: Add storage mode detection to `client/src/lib/runtimeConfig.js`**

Replace the full content:

```javascript
function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/u, '');
}

const apiOrigin = trimTrailingSlash(import.meta.env.VITE_API_BASE_URL || '');

export function resolveApiPath(pathname) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return apiOrigin ? `${apiOrigin}${normalizedPath}` : normalizedPath;
}

export const API_BASE_URL = resolveApiPath('/api');
export const APP_BASENAME = import.meta.env.VITE_APP_BASENAME || '/';

// Storage mode — fetched once from backend, cached
let storageMode = null;

export async function getStorageMode() {
  if (storageMode !== null) return storageMode;
  try {
    const res = await fetch(resolveApiPath('/api/config'));
    if (res.ok) {
      const data = await res.json();
      storageMode = data.storageMode || 'local';
    } else {
      storageMode = 'local';
    }
  } catch {
    storageMode = 'local';
  }
  return storageMode;
}

export function isS3Mode() {
  return storageMode === 's3';
}
```

- [ ] **Step 2: Add S3 upload functions and update existing functions in `client/src/services/api.js`**

Replace the full content:

```javascript
import axios from 'axios';
import { API_BASE_URL, resolveApiPath, getStorageMode, isS3Mode } from '@/lib/runtimeConfig';

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Initialize storage mode on first import (non-blocking)
getStorageMode();

// ── S3 presigned upload helpers ──

async function getPresignedUploadUrls(expName, files) {
  const fileList = files.map(f => ({ name: f.name, type: f.type, size: f.size }));
  const res = await api.post('/upload/presign', { expName, files: fileList });
  return res.data;
}

async function uploadFileToS3(presignedUrl, file) {
  await fetch(presignedUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'audio/wav' },
  });
}

async function confirmUpload(expName, keys) {
  const res = await api.post('/upload/confirm', { expName, keys });
  return res.data;
}

// ── Training audio upload ──

export async function uploadFiles(expName, files) {
  await getStorageMode();

  if (isS3Mode()) {
    const { uploads } = await getPresignedUploadUrls(expName, Array.from(files));
    await Promise.all(uploads.map(({ url }, i) => uploadFileToS3(url, files[i])));
    const keys = uploads.map(u => u.key);
    const confirmation = await confirmUpload(expName, keys);
    return { data: { message: `${confirmation.confirmed} file(s) uploaded`, files: confirmation.files } };
  }

  const formData = new FormData();
  formData.append('expName', expName);
  for (const file of files) {
    formData.append('files', file);
  }
  return api.post('/upload', formData);
}

// ── Reference audio upload ──

export async function uploadRefAudio(file) {
  await getStorageMode();

  if (isS3Mode()) {
    const presignRes = await api.post('/upload-ref/presign', {
      filename: file.name,
      type: file.type,
    });
    const { url, key } = presignRes.data;
    await uploadFileToS3(url, file);
    const confirmRes = await api.post('/upload-ref/confirm', { key });
    return { data: { path: confirmRes.data.key, filename: confirmRes.data.filename } };
  }

  const formData = new FormData();
  formData.append('file', file);
  return api.post('/upload-ref', formData);
}

// ── Training ──

export function startTraining(params) {
  return api.post('/train', params);
}

export function stopTraining(sessionId) {
  return api.post('/train/stop', { sessionId });
}

export function getCurrentTraining() {
  return api.get('/train/current');
}

// ── Models ──

export function getModels() {
  return api.get('/models');
}

export function selectModels(gptPath, sovitsPath) {
  if (isS3Mode()) {
    return api.post('/models/select', { gptKey: gptPath, sovitsKey: sovitsPath });
  }
  return api.post('/models/select', { gptPath, sovitsPath });
}

// ── Transcription ──

export function transcribeAudio(filePath, language = 'auto') {
  return api.post('/transcribe', { filePath, language });
}

// ── Inference ──

export async function synthesize(params) {
  const res = await api.post('/inference', params, {
    responseType: 'blob',
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    const text = await res.data.text();
    let message;
    try {
      message = JSON.parse(text).error;
    } catch {
      message = text;
    }
    throw new Error(message || `Request failed with status ${res.status}`);
  }

  return new Blob([res.data], { type: 'audio/wav' });
}

export function startGeneration(params) {
  return api.post('/inference/generate', params);
}

export function getCurrentInference() {
  return api.get('/inference/current');
}

export async function getGenerationResult(sessionId) {
  await getStorageMode();

  if (isS3Mode()) {
    const res = await api.get(`/inference/result/${sessionId}`);
    const { url } = res.data;
    const audioRes = await fetch(url);
    const blob = await audioRes.blob();
    return new Blob([blob], { type: 'audio/wav' });
  }

  const res = await api.get(`/inference/result/${sessionId}`, { responseType: 'blob' });
  return new Blob([res.data], { type: 'audio/wav' });
}

export function cancelGeneration(sessionId) {
  return api.post('/inference/cancel', { sessionId });
}

export function getInferenceStatus() {
  return api.get('/inference/status');
}

// ── Training audio browser ──

export function getTrainingAudioFiles(expName) {
  return api.get(`/training-audio/${encodeURIComponent(expName)}`);
}

export async function getTrainingAudioUrl(expName, filename) {
  await getStorageMode();

  if (isS3Mode()) {
    const res = await api.get(`/training-audio/file/${encodeURIComponent(expName)}/${encodeURIComponent(filename)}`);
    return res.data.url;
  }

  return resolveApiPath(`/api/training-audio/file/${encodeURIComponent(expName)}/${encodeURIComponent(filename)}`);
}

export async function getUploadedRefAudioUrl(filePath) {
  await getStorageMode();

  if (isS3Mode()) {
    const res = await api.get('/ref-audio', { params: { filePath } });
    return res.data.url;
  }

  return resolveApiPath(`/api/ref-audio?filePath=${encodeURIComponent(filePath)}`);
}
```

- [ ] **Step 3: Verify client builds without errors**

```bash
cd client
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/runtimeConfig.js client/src/services/api.js
git commit -m "feat: frontend S3 upload/download flows with storage mode detection"
```

---

## Task 12: Frontend — Update InferencePage for Async Audio URLs

**Files:**
- Modify: `client/src/pages/InferencePage.jsx`

All 15 usages of `getTrainingAudioUrl` and `getUploadedRefAudioUrl` are in `InferencePage.jsx`. These functions changed from sync (returning a string) to async (returning a Promise). Every call site needs to `await` the result.

**Usage categories and fixes:**

**A. State setter calls (lines 267, 388, 392, 403, 407, 422, 433):**
These are inside `useEffect` hooks that are already async-compatible. Wrap each call with `await`:

```javascript
// Before:
setRefAudioUrl(getUploadedRefAudioUrl(primaryRefPath));

// After:
setRefAudioUrl(await getUploadedRefAudioUrl(primaryRefPath));
```

For ternary fallback patterns:
```javascript
// Before:
setRefAudioUrl(prev => prev || getUploadedRefAudioUrl(uploadedMatch.serverPath));

// After (extract from state setter — can't await inside setter callback):
if (!refAudioUrl) {
  const url = await getUploadedRefAudioUrl(uploadedMatch.serverPath);
  setRefAudioUrl(url);
}
```

**B. Helper function `getReferenceUrl` (line 517):** Make it async:
```javascript
// Before:
function getReferenceUrl(reference, fallbackExpName = currentExpName) {
  if (!reference?.path) return null;
  if (reference.source === 'uploaded') {
    return getUploadedRefAudioUrl(reference.path);
  }
  // ...
  return getTrainingAudioUrl(expName, reference.name || getFallbackReferenceName(reference.path));
}

// After:
async function getReferenceUrl(reference, fallbackExpName = currentExpName) {
  if (!reference?.path) return null;
  if (reference.source === 'uploaded') {
    return getUploadedRefAudioUrl(reference.path);
  }
  // ...
  return getTrainingAudioUrl(expName, reference.name || getFallbackReferenceName(reference.path));
}
```
Then `await` all calls to `getReferenceUrl()`.

**C. `ensureUploadedReferences` helper (line 537):** The `localUrl` property is set inside a state setter callback, which can't be async. Restructure to compute URLs first:
```javascript
// After:
async function ensureUploadedReferences(entries) {
  if (!entries.length) return;
  const newEntries = [];
  const existingPaths = new Set(uploadedRefFiles.map(f => f.serverPath));
  for (const entry of entries) {
    if (!entry?.path || existingPaths.has(entry.path)) continue;
    const localUrl = await getUploadedRefAudioUrl(entry.path);
    newEntries.push({
      name: entry.name || getFallbackReferenceName(entry.path),
      serverPath: entry.path,
      localUrl,
    });
  }
  if (newEntries.length > 0) {
    setUploadedRefFiles(prev => [...prev, ...newEntries]);
  }
}
```

**D. Event handler calls (lines 685, 689, 708):** These are in `handleSelectTrainingAudio` and `handleToggleAuxRef`. Make handlers async and await:
```javascript
// Before:
function handleSelectTrainingAudio(file) {
  setRefAudioUrl(getTrainingAudioUrl(currentExpName, file.filename));
  // ...
}

// After:
async function handleSelectTrainingAudio(file) {
  const url = await getTrainingAudioUrl(currentExpName, file.filename);
  setRefAudioUrl(url);
  // ...
}
```

**E. JSX inline handlers (lines 1146, 1233):** These are `onClick` handlers that create preview objects. Make them async:
```javascript
// Before:
onClick={() => setPreview({
  path: file.path,
  url: getTrainingAudioUrl(currentExpName, file.filename),
  name: file.filename,
  role: 'preview',
})}

// After:
onClick={async () => {
  const url = await getTrainingAudioUrl(currentExpName, file.filename);
  setPreview({
    path: file.path,
    url,
    name: file.filename,
    role: 'preview',
  });
}}
```

**F. Draft restoration `restoreDraft` (line 226):** The `.map()` creates objects with `localUrl`. Restructure to use `Promise.all`:
```javascript
// After:
const restoredFiles = await Promise.all(
  (draft.uploadedRefFiles || []).map(async (file) => ({
    ...file,
    localUrl: await getUploadedRefAudioUrl(file.serverPath),
  }))
);
setUploadedRefFiles(restoredFiles);
```

- [ ] **Step 1: Make `restoreDraft`, `restoreInferenceState`, and helper functions async. Update all 15 call sites as described above.**

- [ ] **Step 2: Verify client builds without errors**

```bash
cd client
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/InferencePage.jsx
git commit -m "feat: update InferencePage for async audio URL resolution"
```

---

## Task 13: GPU Worker — Project Scaffold

**Files:**
- Create: `gpu-worker/package.json`
- Create: `gpu-worker/src/index.js`
- Create: `gpu-worker/src/config.js`
- Create: `gpu-worker/src/utils/paths.js`
- Create: `gpu-worker/src/services/trainingSteps.js`

- [ ] **Step 1: Create `gpu-worker/package.json`**

```json
{
  "name": "voice-cloning-gpu-worker",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node src/index.js"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.700.0",
    "@aws-sdk/s3-request-presigner": "^3.700.0",
    "cors": "^2.8.5",
    "express": "^4.21.0",
    "js-yaml": "^4.1.0",
    "uuid": "^10.0.0"
  }
}
```

- [ ] **Step 2: Create `gpu-worker/src/config.js`**

```javascript
import path from 'path';
import fs from 'fs';

function readEnv(key) {
  return process.env[key] || '';
}

function parseIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const GPT_SOVITS_ROOT = path.resolve(readEnv('GPT_SOVITS_ROOT'));
export const S3_BUCKET = readEnv('S3_BUCKET');
export const S3_REGION = readEnv('S3_REGION');
export const S3_PREFIX = readEnv('S3_PREFIX') || '';
export const WORKER_PORT = parseIntegerEnv(readEnv('WORKER_PORT'), 3001);
export const WORKER_HOST = readEnv('WORKER_HOST') || '0.0.0.0';

// Local temp directory for training data
export const LOCAL_TEMP_ROOT = readEnv('LOCAL_TEMP_ROOT') || path.join(GPT_SOVITS_ROOT, 'worker_temp');

// Python resolution (same logic as server)
const runtimeDir = path.join(GPT_SOVITS_ROOT, 'runtime');
const pythonCandidates = [
  path.join(runtimeDir, 'python.exe'),
  path.join(runtimeDir, 'bin', 'python'),
  process.env.PYTHON_EXEC || '',
].filter(Boolean);

export const PYTHON_EXEC = pythonCandidates.find(c => fs.existsSync(c))
  || process.env.PYTHON_EXEC
  || (process.platform === 'win32' ? 'python.exe' : 'python3');

export const SCRIPTS = {
  slice: path.join(GPT_SOVITS_ROOT, 'tools', 'slice_audio.py'),
  denoise: path.join(GPT_SOVITS_ROOT, 'tools', 'cmd-denoise.py'),
  asr: path.join(GPT_SOVITS_ROOT, 'tools', 'asr', 'fasterwhisper_asr.py'),
  transcribeSingle: path.join(GPT_SOVITS_ROOT, 'tools', 'asr', 'transcribe_single.py'),
  getText: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'prepare_datasets', '1-get-text.py'),
  getHubert: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'prepare_datasets', '2-get-hubert-wav32k.py'),
  getSemantic: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'prepare_datasets', '3-get-semantic.py'),
  trainSoVITS: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 's2_train.py'),
  trainGPT: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 's1_train.py'),
};

export const PRETRAINED = {
  sovitsG: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's2G2333k.pth'),
  sovitsD: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's2D2333k.pth'),
  gpt: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'gsv-v2final-pretrained', 's1bert25hz-5kh-longer-epoch=12-step=369668.ckpt'),
  bert: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'chinese-roberta-wwm-ext-large'),
  hubert: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'pretrained_models', 'chinese-hubert-base'),
};

export const CONFIG_TEMPLATES = {
  sovits: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'configs', 's2.json'),
  gpt: path.join(GPT_SOVITS_ROOT, 'GPT_SoVITS', 'configs', 's1longer-v2.yaml'),
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
  console.warn(`[gpu-worker] GPT_SOVITS_ROOT not found: ${GPT_SOVITS_ROOT}`);
}
if (!S3_BUCKET || !S3_REGION) {
  console.warn('[gpu-worker] S3_BUCKET or S3_REGION not configured');
}
console.log(`[gpu-worker] GPT-SoVITS root: ${GPT_SOVITS_ROOT}`);
console.log(`[gpu-worker] Python: ${PYTHON_EXEC}`);
console.log(`[gpu-worker] S3: ${S3_BUCKET} (${S3_REGION}), prefix: "${S3_PREFIX}"`);
```

- [ ] **Step 3: Copy utility files from server**

Copy these files verbatim from `server/src/`:
- `server/src/utils/paths.js` → `gpu-worker/src/utils/paths.js`
- `server/src/services/trainingSteps.js` → `gpu-worker/src/services/trainingSteps.js`

- [ ] **Step 4: Create `gpu-worker/src/index.js`**

```javascript
import express from 'express';
import cors from 'cors';
import { WORKER_PORT, WORKER_HOST } from './config.js';
import trainingRoutes from './routes/training.js';
import modelsRoutes from './routes/models.js';
import transcribeRoutes from './routes/transcribe.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'gpu-worker', timestamp: Date.now() });
});

app.use('/', trainingRoutes);
app.use('/', modelsRoutes);
app.use('/', transcribeRoutes);

const server = app.listen(WORKER_PORT, WORKER_HOST, () => {
  console.log(`[gpu-worker] Running on http://${WORKER_HOST}:${WORKER_PORT}`);
});

server.timeout = 0;
server.keepAliveTimeout = 0;

process.on('uncaughtException', (err) => console.error('[gpu-worker] UNCAUGHT', err));
process.on('unhandledRejection', (r) => console.error('[gpu-worker] UNHANDLED', r));
```

- [ ] **Step 5: Create `gpu-worker/.gitignore`**

```
node_modules/
.env
```

- [ ] **Step 6: Install dependencies**

```bash
cd gpu-worker
npm install
```

- [ ] **Step 7: Commit**

```bash
git add gpu-worker/package.json gpu-worker/package-lock.json gpu-worker/.gitignore gpu-worker/src/index.js gpu-worker/src/config.js gpu-worker/src/utils/paths.js gpu-worker/src/services/trainingSteps.js
git commit -m "feat: GPU Worker project scaffold with config and entry point"
```

---

## Task 14: GPU Worker — S3 Sync Service

**Files:**
- Create: `gpu-worker/src/services/s3Sync.js`

- [ ] **Step 1: Create `gpu-worker/src/services/s3Sync.js`**

```javascript
import fs from 'fs';
import path from 'path';
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { S3_BUCKET, S3_REGION, S3_PREFIX } from '../config.js';

let client = null;

function getClient() {
  if (!client) {
    client = new S3Client({ region: S3_REGION });
  }
  return client;
}

function fullKey(key) {
  const prefix = S3_PREFIX ? S3_PREFIX.replace(/\/+$/, '') + '/' : '';
  return prefix + key;
}

function stripPrefix(key) {
  const prefix = S3_PREFIX ? S3_PREFIX.replace(/\/+$/, '') + '/' : '';
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export async function downloadPrefix(s3Prefix, localDir) {
  fs.mkdirSync(localDir, { recursive: true });

  let continuationToken;
  let count = 0;
  do {
    const response = await getClient().send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: fullKey(s3Prefix),
      ContinuationToken: continuationToken,
    }));

    if (response.Contents) {
      for (const obj of response.Contents) {
        const relativeKey = stripPrefix(obj.Key);
        const relativePath = relativeKey.slice(s3Prefix.length);
        if (!relativePath || relativePath.endsWith('/')) continue;

        const localPath = path.join(localDir, relativePath);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });

        const getRes = await getClient().send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: obj.Key,
        }));

        const chunks = [];
        for await (const chunk of getRes.Body) {
          chunks.push(chunk);
        }
        fs.writeFileSync(localPath, Buffer.concat(chunks));
        count += 1;
      }
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return count;
}

export async function uploadDirectory(localDir, s3Prefix) {
  if (!fs.existsSync(localDir)) return 0;

  let count = 0;
  const entries = fs.readdirSync(localDir, { withFileTypes: true });

  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    if (entry.isDirectory()) {
      count += await uploadDirectory(localPath, `${s3Prefix}${entry.name}/`);
    } else {
      const fileBuffer = fs.readFileSync(localPath);
      const key = `${s3Prefix}${entry.name}`;
      await getClient().send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: fullKey(key),
        Body: fileBuffer,
      }));
      count += 1;
    }
  }

  return count;
}

export async function uploadFile(localPath, s3Key) {
  const fileBuffer = fs.readFileSync(localPath);
  await getClient().send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: fullKey(s3Key),
    Body: fileBuffer,
  }));
}

export async function downloadFile(s3Key, localPath) {
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const response = await getClient().send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: fullKey(s3Key),
  }));
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  fs.writeFileSync(localPath, Buffer.concat(chunks));
}
```

- [ ] **Step 2: Commit**

```bash
git add gpu-worker/src/services/s3Sync.js
git commit -m "feat: GPU Worker S3 sync service for directory upload/download"
```

---

## Task 15: GPU Worker — Process Manager, Config Generator, Training State

**Files:**
- Create: `gpu-worker/src/services/processManager.js`
- Create: `gpu-worker/src/services/sseManager.js`
- Create: `gpu-worker/src/services/configGenerator.js`
- Create: `gpu-worker/src/services/trainingState.js`

- [ ] **Step 1: Copy and adapt `processManager.js`**

Copy `server/src/services/processManager.js` to `gpu-worker/src/services/processManager.js`.

Change the import on line 4 from:

```javascript
import { PYTHON_EXEC, GPT_SOVITS_ROOT, assertConfig, buildPythonEnv } from '../config.js';
```

To:

```javascript
import { PYTHON_EXEC, GPT_SOVITS_ROOT, buildPythonEnv } from '../config.js';
```

Remove the `assertConfig` call inside `run()` (lines 33–36). Replace with a simple check:

```javascript
      if (!PYTHON_EXEC) {
        reject(new Error('PYTHON_EXEC is not configured'));
        return;
      }
```

- [ ] **Step 2: Copy `sseManager.js` verbatim**

Copy `server/src/services/sseManager.js` to `gpu-worker/src/services/sseManager.js` — no changes needed.

- [ ] **Step 3: Copy and adapt `configGenerator.js`**

Copy `server/src/services/configGenerator.js` to `gpu-worker/src/services/configGenerator.js`.

Change the import on line 5 from:

```javascript
import {
  CONFIG_TEMPLATES,
  PRETRAINED,
  GPT_SOVITS_ROOT,
  TEMP_DIR,
  WEIGHT_DIRS,
} from '../config.js';
```

To:

```javascript
import {
  CONFIG_TEMPLATES,
  PRETRAINED,
  GPT_SOVITS_ROOT,
  LOCAL_TEMP_ROOT,
} from '../config.js';
```

Replace all references to `TEMP_DIR` with `LOCAL_TEMP_ROOT`.

Replace `WEIGHT_DIRS.sovits` with a parameter: update `generateSoVITSConfig` to accept `weightsDir` as a parameter:

```javascript
export function generateSoVITSConfig({ expName, batchSize = 2, epochs = 20, saveEveryEpoch = 4, weightsDir }) {
  // ...
  template.save_weight_dir = weightsDir;
  // ...
  fs.mkdirSync(weightsDir, { recursive: true });
  // ...
}
```

Same for `generateGPTConfig`:

```javascript
export function generateGPTConfig({ expName, batchSize = 2, epochs = 25, saveEveryEpoch = 5, weightsDir }) {
  // ...
  template.train.half_weights_save_dir = weightsDir;
  // ...
  fs.mkdirSync(weightsDir, { recursive: true });
  // ...
}
```

- [ ] **Step 4: Copy `trainingState.js` verbatim**

Copy `server/src/services/trainingState.js` to `gpu-worker/src/services/trainingState.js`. Update the import path:

```javascript
import { STEPS } from './trainingSteps.js';
```

(This is already the same — no change needed.)

- [ ] **Step 5: Commit**

```bash
git add gpu-worker/src/services/processManager.js gpu-worker/src/services/sseManager.js gpu-worker/src/services/configGenerator.js gpu-worker/src/services/trainingState.js
git commit -m "feat: GPU Worker process manager, SSE, config generator, training state"
```

---

## Task 16: GPU Worker — Training Pipeline with S3 Sync

**Files:**
- Create: `gpu-worker/src/services/pipeline.js`
- Create: `gpu-worker/src/routes/training.js`

- [ ] **Step 1: Create `gpu-worker/src/services/pipeline.js`**

This is adapted from `server/src/services/pipeline.js`, with S3 sync at the beginning and end.

```javascript
import fs from 'fs';
import path from 'path';
import {
  GPT_SOVITS_ROOT,
  SCRIPTS,
  PRETRAINED,
  CONFIG_TEMPLATES,
  LOCAL_TEMP_ROOT,
} from '../config.js';
import { processManager } from './processManager.js';
import { sseManager } from './sseManager.js';
import { trainingState } from './trainingState.js';
import { generateSoVITSConfig, generateGPTConfig } from './configGenerator.js';
import { STEPS } from './trainingSteps.js';
import { downloadPrefix, uploadDirectory, uploadFile } from './s3Sync.js';

function sendStep(sessionId, stepIndex, status, detail) {
  trainingState.setStepStatus(stepIndex, status, detail || '');
  sseManager.send(sessionId, 'step-start', {
    step: stepIndex,
    name: STEPS[stepIndex],
    status,
    detail: detail || '',
  });
}

function completeStep(sessionId, stepIndex, code = 0) {
  trainingState.setStepStatus(stepIndex, code === 0 ? 'done' : 'error');
  sseManager.send(sessionId, 'step-complete', {
    step: stepIndex,
    name: STEPS[stepIndex],
    code,
  });
}

function dirHasFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return false;
  const files = fs.readdirSync(dir);
  return pattern ? files.some(f => pattern.test(f)) : files.length > 0;
}

function assertDirHasFiles(dir, pattern, stepName) {
  if (!dirHasFiles(dir, pattern)) {
    throw new Error(`${stepName} failed: no output files produced in ${dir}`);
  }
}

function mergePartFiles(dir, baseName, ext) {
  const partFile = path.join(dir, `${baseName}-0${ext}`);
  const outFile = path.join(dir, `${baseName}${ext}`);
  if (!fs.existsSync(partFile)) return;
  const content = fs.readFileSync(partFile, 'utf-8');
  fs.writeFileSync(outFile, content);
}

function skipStep(sessionId, stepIndex, reason) {
  sendStep(sessionId, stepIndex, 'skipped', reason);
  sseManager.send(sessionId, 'log', {
    stream: 'stdout',
    data: `Skipping "${STEPS[stepIndex]}": ${reason}\n`,
    timestamp: Date.now(),
  });
  completeStep(sessionId, stepIndex, 0);
  return 'skipped';
}

export async function runPipelineWithS3(sessionId, {
  expName,
  s3Prefix: rawAudioPrefix,
  batchSize = 2,
  sovitsEpochs = 8,
  gptEpochs = 15,
  sovitsSaveEvery = 4,
  gptSaveEvery = 5,
  asrLanguage = 'en',
  asrModel = 'large-v3',
}) {
  const localExpDir = path.join(LOCAL_TEMP_ROOT, expName);
  const dataDir = path.join(localExpDir, 'data');
  const rawDir = path.join(dataDir, 'raw');
  const slicedDir = path.join(dataDir, 'sliced');
  const denoisedDir = path.join(dataDir, 'denoised');
  const asrDir = path.join(dataDir, 'asr');
  const logsDir = path.join(GPT_SOVITS_ROOT, 'logs', expName);
  const sovitsWeightsDir = path.join(localExpDir, 'weights', 'sovits');
  const gptWeightsDir = path.join(localExpDir, 'weights', 'gpt');

  for (const dir of [rawDir, slicedDir, denoisedDir, asrDir, logsDir, sovitsWeightsDir, gptWeightsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // ── S3 Sync Down ──
  sseManager.send(sessionId, 'log', {
    stream: 'stdout',
    data: `Downloading training audio from S3: ${rawAudioPrefix}\n`,
    timestamp: Date.now(),
  });

  const downloadCount = await downloadPrefix(rawAudioPrefix, rawDir);
  sseManager.send(sessionId, 'log', {
    stream: 'stdout',
    data: `Downloaded ${downloadCount} files from S3\n`,
    timestamp: Date.now(),
  });

  if (downloadCount === 0) {
    throw new Error('No training audio files found in S3');
  }

  function getAsrListFile() {
    const asrFiles = fs.readdirSync(asrDir).filter(f => f.endsWith('.list'));
    return asrFiles.length > 0
      ? path.join(asrDir, asrFiles[0])
      : path.join(asrDir, 'denoised.list');
  }

  const steps = [
    // Step 0: Slice Audio
    async () => {
      if (dirHasFiles(slicedDir, /\.(wav|mp3|ogg|flac)$/i)) {
        return skipStep(sessionId, 0, 'sliced audio already exists');
      }
      sendStep(sessionId, 0, 'running');
      await processManager.run({
        scriptPath: SCRIPTS.slice,
        args: [rawDir, slicedDir, '-34', '4000', '300', '10', '500', '0.9', '0.25', '0', '1'],
        sessionId,
      });
      assertDirHasFiles(slicedDir, /\.(wav|mp3|ogg|flac)$/i, 'Slice');
    },

    // Step 1: Denoise
    async () => {
      if (dirHasFiles(denoisedDir, /\.(wav|mp3|ogg|flac)$/i)) {
        return skipStep(sessionId, 1, 'denoised audio already exists');
      }
      sendStep(sessionId, 1, 'running');
      await processManager.run({
        scriptPath: SCRIPTS.denoise,
        args: ['-i', slicedDir, '-o', denoisedDir, '-p', 'float16'],
        sessionId,
      });
      assertDirHasFiles(denoisedDir, /\.(wav|mp3|ogg|flac)$/i, 'Denoise');
    },

    // Step 2: ASR
    async () => {
      if (dirHasFiles(asrDir, /\.list$/i)) {
        return skipStep(sessionId, 2, 'ASR transcript already exists');
      }
      sendStep(sessionId, 2, 'running');
      await processManager.run({
        scriptPath: SCRIPTS.asr,
        args: ['-i', denoisedDir, '-o', asrDir, '-s', asrModel, '-l', asrLanguage, '-p', 'int8'],
        sessionId,
      });
      assertDirHasFiles(asrDir, /\.list$/i, 'ASR');
    },

    // Step 3: 1-get-text.py
    async () => {
      if (fs.existsSync(path.join(logsDir, '2-name2text.txt'))) {
        return skipStep(sessionId, 3, 'text features already extracted');
      }
      sendStep(sessionId, 3, 'running');
      await processManager.run({
        scriptPath: SCRIPTS.getText,
        args: [],
        env: {
          inp_text: getAsrListFile(),
          inp_wav_dir: denoisedDir,
          exp_name: expName,
          opt_dir: logsDir,
          bert_pretrained_dir: PRETRAINED.bert,
          is_half: 'True',
          _CUDA_VISIBLE_DEVICES: '0',
          i_part: '0',
          all_parts: '1',
          version: 'v2',
        },
        sessionId,
      });
      mergePartFiles(logsDir, '2-name2text', '.txt');
    },

    // Step 4: 2-get-hubert-wav32k.py
    async () => {
      if (dirHasFiles(path.join(logsDir, '4-cnhubert'))) {
        return skipStep(sessionId, 4, 'HuBERT features already extracted');
      }
      sendStep(sessionId, 4, 'running');
      await processManager.run({
        scriptPath: SCRIPTS.getHubert,
        args: [],
        env: {
          inp_text: getAsrListFile(),
          inp_wav_dir: denoisedDir,
          exp_name: expName,
          opt_dir: logsDir,
          cnhubert_base_dir: PRETRAINED.hubert,
          is_half: 'True',
          _CUDA_VISIBLE_DEVICES: '0',
          i_part: '0',
          all_parts: '1',
        },
        sessionId,
      });
    },

    // Step 5: 3-get-semantic.py
    async () => {
      if (fs.existsSync(path.join(logsDir, '6-name2semantic.tsv'))) {
        return skipStep(sessionId, 5, 'semantic features already extracted');
      }
      sendStep(sessionId, 5, 'running');
      await processManager.run({
        scriptPath: SCRIPTS.getSemantic,
        args: [],
        env: {
          inp_text: getAsrListFile(),
          exp_name: expName,
          opt_dir: logsDir,
          pretrained_s2G: PRETRAINED.sovitsG,
          s2config_path: CONFIG_TEMPLATES.sovits,
          is_half: 'True',
          _CUDA_VISIBLE_DEVICES: '0',
          i_part: '0',
          all_parts: '1',
        },
        sessionId,
      });
      mergePartFiles(logsDir, '6-name2semantic', '.tsv');
    },

    // Step 6: Train SoVITS
    async () => {
      sendStep(sessionId, 6, 'running');
      const configPath = generateSoVITSConfig({
        expName,
        batchSize,
        epochs: sovitsEpochs,
        saveEveryEpoch: sovitsSaveEvery,
        weightsDir: sovitsWeightsDir,
      });
      await processManager.run({
        scriptPath: SCRIPTS.trainSoVITS,
        args: ['--config', configPath],
        sessionId,
      });
    },

    // Step 7: Train GPT
    async () => {
      sendStep(sessionId, 7, 'running');
      const configPath = generateGPTConfig({
        expName,
        batchSize,
        epochs: gptEpochs,
        saveEveryEpoch: gptSaveEvery,
        weightsDir: gptWeightsDir,
      });
      await processManager.run({
        scriptPath: SCRIPTS.trainGPT,
        args: ['--config_file', configPath],
        env: { _CUDA_VISIBLE_DEVICES: '0', hz: '25hz' },
        sessionId,
      });
    },
  ];

  try {
    trainingState.setStatus('running');

    for (let i = 0; i < steps.length; i++) {
      const result = await steps[i]();
      if (result !== 'skipped') {
        completeStep(sessionId, i, 0);
      }
    }

    // ── S3 Sync Up ──
    sseManager.send(sessionId, 'log', {
      stream: 'stdout',
      data: 'Uploading results to S3...\n',
      timestamp: Date.now(),
    });

    const s3DataPrefix = `training/datasets/${expName}/`;
    await uploadDirectory(denoisedDir, `${s3DataPrefix}denoised/`);
    await uploadDirectory(asrDir, `${s3DataPrefix}asr/`);
    await uploadDirectory(sovitsWeightsDir, `models/user-models/sovits/`);
    await uploadDirectory(gptWeightsDir, `models/user-models/gpt/`);

    sseManager.send(sessionId, 'log', {
      stream: 'stdout',
      data: 'S3 upload complete\n',
      timestamp: Date.now(),
    });

    trainingState.setStatus('complete');
    sseManager.send(sessionId, 'pipeline-complete', { success: true });
  } catch (err) {
    const errorMsg = parseError(err.message || String(err));
    trainingState.setError(errorMsg);
    sseManager.send(sessionId, 'error', { message: errorMsg, raw: String(err) });
  }
}

function parseError(msg) {
  if (/CUDA out of memory|OutOfMemoryError/i.test(msg)) {
    return 'GPU out of memory. Try reducing batch size.';
  }
  if (/FileNotFoundError/i.test(msg)) {
    return 'Required file not found. Check that audio files were uploaded correctly.';
  }
  if (/exited with code/i.test(msg)) {
    return 'Step failed. Check logs for details.';
  }
  return msg;
}

export { STEPS };
```

- [ ] **Step 2: Create `gpu-worker/src/routes/training.js`**

```javascript
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sseManager } from '../services/sseManager.js';
import { processManager } from '../services/processManager.js';
import { runPipelineWithS3, STEPS } from '../services/pipeline.js';
import { trainingState } from '../services/trainingState.js';

const router = Router();
const sessions = new Map();

router.post('/train', (req, res) => {
  const { expName, config = {} } = req.body;

  if (!expName) {
    return res.status(400).json({ error: 'expName is required' });
  }
  if (sessions.size > 0 || processManager.hasRunningProcesses()) {
    return res.status(409).json({ error: 'A training pipeline is already running' });
  }

  const sessionId = uuidv4();
  const s3Prefix = `training/datasets/${expName}/raw/`;

  sessions.set(sessionId, { expName, startedAt: Date.now() });
  trainingState.resetForNewSession({ sessionId, expName });
  sseManager.prepareSession(sessionId);

  res.json({ sessionId, steps: STEPS });

  sseManager.waitForClient(sessionId).then(() => {
    return runPipelineWithS3(sessionId, {
      expName,
      s3Prefix,
      batchSize: config.batchSize,
      sovitsEpochs: config.sovitsEpochs,
      gptEpochs: config.gptEpochs,
      sovitsSaveEvery: config.sovitsSaveEvery,
      gptSaveEvery: config.gptSaveEvery,
      asrLanguage: config.asrLanguage,
      asrModel: config.asrModel,
    });
  }).catch((err) => {
    trainingState.setError(err.message || 'Pipeline failed');
    sseManager.send(sessionId, 'error', { message: err.message || 'Pipeline failed' });
  }).finally(() => {
    sessions.delete(sessionId);
  });
});

router.get('/train/progress/:sessionId', (req, res) => {
  sseManager.addClient(req.params.sessionId, res);
});

router.post('/train/stop', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  const killed = processManager.kill(sessionId);
  if (killed) {
    trainingState.setStatus('stopped');
    sseManager.send(sessionId, 'error', { message: 'Training stopped by user' });
    sessions.delete(sessionId);
    res.json({ message: 'Training stopped' });
  } else {
    res.status(404).json({ error: 'No running process found' });
  }
});

export default router;
```

- [ ] **Step 3: Commit**

```bash
git add gpu-worker/src/services/pipeline.js gpu-worker/src/routes/training.js
git commit -m "feat: GPU Worker training pipeline with S3 sync"
```

---

## Task 17: GPU Worker — Transcription & Model Download Routes

**Files:**
- Create: `gpu-worker/src/routes/transcribe.js`
- Create: `gpu-worker/src/routes/models.js`

- [ ] **Step 1: Create `gpu-worker/src/routes/transcribe.js`**

```javascript
import { Router } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PYTHON_EXEC, GPT_SOVITS_ROOT, SCRIPTS, LOCAL_TEMP_ROOT, buildPythonEnv } from '../config.js';
import { downloadFile } from '../services/s3Sync.js';

const router = Router();

router.post('/transcribe', async (req, res) => {
  const { s3Key, language = 'auto' } = req.body;
  if (!s3Key) {
    return res.status(400).json({ error: 's3Key is required' });
  }

  const localPath = path.join(LOCAL_TEMP_ROOT, 'transcribe', `${Date.now()}_${path.basename(s3Key)}`);

  try {
    await downloadFile(s3Key, localPath);

    const result = await new Promise((resolve, reject) => {
      const args = [
        '-c',
        [
          'import runpy, sys',
          `ROOT = ${JSON.stringify(GPT_SOVITS_ROOT)}`,
          `TOOLS = ROOT + "/tools"`,
          `GPT = ROOT + "/GPT_SoVITS"`,
          `SCRIPT = ${JSON.stringify(SCRIPTS.transcribeSingle)}`,
          'sys.path[:0] = [path for path in (GPT, TOOLS, ROOT) if path and path not in sys.path]',
          'sys.argv = [SCRIPT, *sys.argv[1:]]',
          'runpy.run_path(SCRIPT, run_name="__main__")',
        ].join('; '),
        '-i', localPath,
        '-l', language,
        '-s', 'medium',
        '-p', 'int8',
      ];

      const proc = spawn(PYTHON_EXEC, args, {
        cwd: GPT_SOVITS_ROOT,
        env: buildPythonEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
        console.log('[transcribe]', d.toString().trim());
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(stderr || `Transcription exited with code ${code}`));
        }
        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        try {
          resolve(JSON.parse(lastLine));
        } catch {
          reject(new Error('Failed to parse transcription output'));
        }
      });

      proc.on('error', reject);
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    try { fs.unlinkSync(localPath); } catch { /* ignore */ }
  }
});

export default router;
```

- [ ] **Step 2: Create `gpu-worker/src/routes/models.js`**

```javascript
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { LOCAL_TEMP_ROOT } from '../config.js';
import { downloadFile } from '../services/s3Sync.js';

const router = Router();

const modelCache = path.join(LOCAL_TEMP_ROOT, 'model_cache');

router.post('/models/download', async (req, res) => {
  const { s3Key } = req.body;
  if (!s3Key) {
    return res.status(400).json({ error: 's3Key is required' });
  }

  const filename = path.basename(s3Key);
  const localPath = path.join(modelCache, filename);

  try {
    // Skip download if already cached
    if (!fs.existsSync(localPath)) {
      fs.mkdirSync(modelCache, { recursive: true });
      await downloadFile(s3Key, localPath);
    }
    res.json({ localPath, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 3: Commit**

```bash
git add gpu-worker/src/routes/transcribe.js gpu-worker/src/routes/models.js
git commit -m "feat: GPU Worker transcription and model download endpoints"
```

---

## Task 18: Final — Update .env.example & Verify

**Files:**
- Modify: `server/.env.example`
- Create: `gpu-worker/.env.example`

- [ ] **Step 1: Create `gpu-worker/.env.example`**

```env
# Required: path to GPT-SoVITS installation on the GPU instance
GPT_SOVITS_ROOT=/opt/gpt-sovits

# Required: S3 configuration
S3_BUCKET=my-voice-cloning-bucket
S3_REGION=ap-southeast-1
# S3_PREFIX=prod/

# Optional: Worker server settings
# WORKER_PORT=3001
# WORKER_HOST=0.0.0.0

# Optional: local temp directory for training data
# LOCAL_TEMP_ROOT=/mnt/local-ssd/worker_temp
```

- [ ] **Step 2: Verify server starts in local mode (no S3)**

```bash
cd server
node src/index.js
```

Expected: Server starts, logs `Storage mode: local`. All existing routes should work as before. Stop with Ctrl+C.

- [ ] **Step 3: Verify client builds**

```bash
cd client
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add gpu-worker/.env.example server/.env.example
git commit -m "docs: add .env.example files for S3 and GPU Worker configuration"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Install AWS SDK + config vars | `server/package.json`, `server/src/config.js` |
| 2 | S3 storage service | `server/src/services/s3Storage.js` |
| 3 | Config endpoint + .env.example | `server/src/index.js` |
| 4 | Presigned upload endpoints | `server/src/routes/upload.js` |
| 5 | Training audio S3 serving | `server/src/routes/inference.js` |
| 6 | Ref audio, models, inference result S3 | `server/src/routes/inference.js` |
| 7 | Inference dual delivery | `server/src/services/longTextInference.js` |
| 8 | Transcription S3 mode | `server/src/routes/inference.js` |
| 9 | Training route S3 delegation | `server/src/routes/training.js` |
| 10 | GPU Worker client | `server/src/services/gpuWorkerClient.js` |
| 11 | Frontend S3 flows | `client/src/services/api.js`, `client/src/lib/runtimeConfig.js` |
| 12 | Frontend async audio URLs | Various components |
| 13 | GPU Worker scaffold | `gpu-worker/` project |
| 14 | GPU Worker S3 sync | `gpu-worker/src/services/s3Sync.js` |
| 15 | GPU Worker services | `gpu-worker/src/services/` (5 files) |
| 16 | GPU Worker training pipeline | `gpu-worker/src/services/pipeline.js`, `gpu-worker/src/routes/training.js` |
| 17 | GPU Worker transcription + models | `gpu-worker/src/routes/transcribe.js`, `gpu-worker/src/routes/models.js` |
| 18 | Final env examples + verify | `.env.example` files |
