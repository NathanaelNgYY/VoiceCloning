# S3 Storage Integration — Design Spec

## Overview

Migrate the Voice Cloning webapp from local filesystem storage to AWS S3 for all file operations (uploads, downloads, model weights, training data, inference output). This enables split-host cloud deployment where the backend EC2 and GPU EC2 are separate machines with no shared filesystem.

A `STORAGE_MODE` toggle (`local` | `s3`) preserves full backward compatibility — local development works exactly as today.

---

## Architecture

```
Browser
  │
  ├─ Presigned PUT ──────────────────► S3 Bucket
  │                                      │
  ├─ REST / SSE ──► Backend EC2          │
  │                   │                  │
  │                   ├─ presign URLs ───┘
  │                   ├─ relay SSE ◄──── GPU Worker
  │                   └─ metadata ────── (in-memory / future DB)
  │
  └─ Presigned GET ◄──────────────────── S3 Bucket

GPU EC2
  ├─ Inference server (api_v2.py :9880)
  └─ GPU Worker API (:3001)
       ├─ S3 sync down (training data)
       ├─ run pipeline (Python scripts)
       ├─ S3 sync up (weights, denoised, ASR)
       └─ SSE progress → Backend
```

---

## 1. S3 Storage Service

**New file:** `server/src/services/s3Storage.js`

**Dependencies:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

### Configuration (new env vars in `config.js`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `STORAGE_MODE` | No | `local` | `local` or `s3` |
| `S3_BUCKET` | When `s3` | — | Bucket name |
| `S3_REGION` | When `s3` | — | e.g. `ap-southeast-1` |
| `S3_PREFIX` | No | `""` | Optional namespace prefix (e.g. `prod/`) |
| AWS credentials | When `s3` | IAM role | Standard SDK chain (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` or EC2 instance role) |

### S3 Key Structure

```
{prefix}/training/datasets/{expName}/raw/{filename}
{prefix}/training/datasets/{expName}/denoised/{filename}
{prefix}/training/datasets/{expName}/asr/denoised.list
{prefix}/audio/reference/ref_{timestamp}_{filename}
{prefix}/audio/output/{sessionId}/final.wav
{prefix}/models/user-models/sovits/{filename}.pth
{prefix}/models/user-models/gpt/{filename}.ckpt
```

### Methods

```
generatePresignedPutUrl(key, contentType, expiresIn = 3600) → { url, key }
generatePresignedGetUrl(key, expiresIn = 3600) → url
uploadBuffer(key, buffer, contentType) → void
downloadToFile(key, localPath) → void
listObjects(prefix) → [{ key, size, lastModified }]
deleteObject(key) → void
deletePrefix(prefix) → void
getObject(key) → Buffer
headObject(key) → { size, lastModified } | null
```

### Local-mode behavior

When `STORAGE_MODE=local`, all existing filesystem code paths execute unchanged. No S3 client is instantiated. The storage service exports a `isS3Mode()` helper that routes call `if (isS3Mode()) { ... } else { ... }` to branch behavior.

---

## 2. Upload Flow (Presigned URLs)

### Training Audio

**New endpoints (S3 mode only):**

`POST /api/upload/presign`
- Body: `{ expName, files: [{ name, type, size }] }`
- Validates: `expName` is safe path segment, file extensions are `.wav/.mp3/.ogg/.flac/.m4a`, max 50 files
- Returns: `{ uploads: [{ filename, url, key }] }`
- Each URL is a presigned PUT valid for 1 hour

`POST /api/upload/confirm`
- Body: `{ expName, keys: [string] }`
- Backend verifies each key exists in S3 via `headObject`
- Returns: `{ confirmed: number, files: [string] }`

**Frontend flow:**
1. Call `getPresignedUploadUrls(expName, files)` → receives presigned URLs
2. Upload each file via `fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })`
3. Call `confirmUpload(expName, keys)` to finalize

**Local mode:** Existing `POST /api/upload` with multer stays unchanged.

### Reference Audio

**New endpoints (S3 mode only):**

`POST /api/upload-ref/presign`
- Body: `{ filename, type }`
- Returns: `{ url, key }` where key = `audio/reference/ref_{timestamp}_{sanitizedFilename}`

`POST /api/upload-ref/confirm`
- Body: `{ key }`
- Verifies existence, returns `{ key, filename }`

**Local mode:** Existing `POST /api/upload-ref` with multer stays unchanged.

---

## 3. Download & Serving Flow

### Training Audio Browser

**`GET /api/training-audio/:expName`** (S3 mode):
- Lists S3 objects under `training/datasets/{expName}/denoised/`
- Downloads `training/datasets/{expName}/asr/denoised.list` to parse transcripts
- Returns same response shape as today: `{ expName, files: [{ filename, key, transcript, lang }] }`
- `key` replaces `path` in the response

**`GET /api/training-audio/file/:expName/:filename`** (S3 mode):
- Generates presigned GET URL for `training/datasets/{expName}/denoised/{filename}`
- Returns `{ url }` (frontend uses this URL directly for `<audio src>`)

**Local mode:** Streams from local disk as today.

### Reference Audio Playback

**`GET /api/ref-audio`** (S3 mode):
- `filePath` query param is now an S3 key
- Returns `{ url }` with a presigned GET URL
- Frontend uses this URL for audio playback

**Local mode:** Streams from local disk as today.

### Inference Result

**`GET /api/inference/result/:sessionId`** (S3 mode):
- Returns `{ url }` with a presigned GET URL for `audio/output/{sessionId}/final.wav`

**Dual delivery (S3 mode):**
- Immediate: `POST /api/inference` still returns the WAV buffer directly for instant playback (proxied from GPU inference server)
- Persistence: After inference completes (streaming or synchronous), backend uploads `final.wav` to S3 in parallel. The `inference-complete` SSE event includes `{ s3Key }` so the frontend knows the result is persisted

**Local mode:** Streams from local disk as today.

### Model Listing

**`GET /api/models`** (S3 mode):
- Lists S3 objects under `models/user-models/gpt/` (`.ckpt` files) and `models/user-models/sovits/` (`.pth` files)
- Returns same shape: `{ gpt: [{ name, key }], sovits: [{ name, key }] }`
- `key` replaces `path`

**`POST /api/models/select`** (S3 mode):
- Receives `{ gptKey, sovitsKey }` (S3 keys instead of local paths)
- Backend calls GPU Worker `POST /models/download` with the S3 key. GPU Worker downloads the weight file from S3 to a local cache directory and returns the local path
- Backend then calls inference server's `set_gpt_weights` / `set_sovits_weights` with the local cached path (inference server runs on the same GPU instance)

**Local mode:** Reads from local weight directories as today.

---

## 4. Training Orchestration (GPU Worker)

### Problem

The backend currently spawns Python training scripts via `child_process.spawn`. In split-host mode, the GPU is a separate machine — the backend cannot spawn processes on it.

### Solution: GPU Worker API

A lightweight HTTP server running on the GPU instance that accepts training commands.

**New directory:** `gpu-worker/` at project root

**Stack:** Node.js + Express (reuses existing patterns), or Python + FastAPI (closer to the training scripts). Recommend Node.js for consistency.

### New env vars

| Variable | Required | Default | Description |
|---|---|---|---|
| `GPU_WORKER_HOST` | When `s3` | `INFERENCE_HOST` | GPU worker address |
| `GPU_WORKER_PORT` | When `s3` | `3001` | GPU worker port |

### Training Flow (S3 mode)

1. Frontend: `POST /api/train` on backend (unchanged API)
2. Backend: validates params, sends `POST http://{GPU_WORKER_HOST}:{GPU_WORKER_PORT}/train` with:
   ```json
   {
     "expName": "speaker1",
     "s3Bucket": "my-bucket",
     "s3Prefix": "prod/",
     "s3Keys": {
       "rawAudio": "training/datasets/speaker1/raw/"
     },
     "config": {
       "epochs_sovits": 8,
       "epochs_gpt": 15,
       "batch_size": 4,
       "save_every": 4
     }
   }
   ```
3. GPU Worker:
   - Creates local temp directory for this experiment
   - Downloads raw audio from S3 to local `{localTempDir}/raw/`
   - Runs the 8-step pipeline (Slice → Denoise → ASR → GetText → GetHubert → GetSemantic → TrainSoVITS → TrainGPT) using existing Python scripts
   - Streams progress via SSE at `GET /train/progress/:sessionId`
   - On completion, uploads to S3:
     - `training/datasets/{expName}/denoised/` — denoised WAV files
     - `training/datasets/{expName}/asr/denoised.list` — ASR transcripts
     - `models/user-models/sovits/{expName}*.pth` — SoVITS weights
     - `models/user-models/gpt/{expName}*.ckpt` — GPT weights
   - Cleans up local temp data
4. Backend: relays GPU Worker SSE events to frontend via existing `sseManager`

### Backend Changes

**New file:** `server/src/services/gpuWorkerClient.js`
- HTTP client that talks to GPU Worker API
- Methods: `startTraining(params)`, `stopTraining(sessionId)`, `connectProgressStream(sessionId)` (SSE client)

**Modified:** `server/src/routes/training.js`
- When `isS3Mode()`: delegates to `gpuWorkerClient` instead of spawning local processes
- SSE relay: pipes GPU Worker events through `sseManager` to frontend
- When local mode: existing `child_process.spawn` behavior unchanged

### GPU Worker Internals

The GPU Worker reuses the same training step logic as the current backend:
- Same Python script paths (relative to `GPT_SOVITS_ROOT` on the GPU instance)
- Same `child_process.spawn` pattern
- Same SSE event format (`step-start`, `step-complete`, `pipeline-complete`, `log`)
- Adds S3 sync steps at the beginning and end

**Endpoints:**
- `POST /train` — start training
- `POST /train/stop` — kill training process
- `GET /train/progress/:sessionId` — SSE stream
- `POST /transcribe` — run Whisper transcription on a reference audio (accepts `{ s3Key, language }`)
- `POST /models/download` — download weight file from S3 to local cache, return local path
- `GET /healthz` — health check

---

## 5. Frontend Changes

### New in `client/src/services/api.js`

```
getStorageMode() → 'local' | 's3'
getPresignedUploadUrls(expName, files) → { uploads: [{ filename, url, key }] }
uploadFileToS3(presignedUrl, file, onProgress?) → void
confirmUpload(expName, keys) → { confirmed, files }
getPresignedRefUploadUrl(filename, type) → { url, key }
confirmRefUpload(key) → { key, filename }
```

### Modified functions

- `uploadFiles(expName, files)` — branches on storage mode:
  - S3: presign → direct upload → confirm
  - Local: existing multer POST
- `uploadRefAudio(file)` — same branching pattern
- `getTrainingAudioUrl(expName, filename)` — S3 mode: fetches presigned GET URL; local mode: unchanged
- `getUploadedRefAudioUrl(filePath)` — S3 mode: fetches presigned GET URL; local mode: unchanged
- `getGenerationResult(sessionId)` — S3 mode: can fetch via presigned URL from S3; local mode: unchanged

### Storage mode detection

Backend exposes `GET /api/config` (or include in existing `/healthz` or `/readyz`):
```json
{ "storageMode": "s3" }
```

Frontend fetches this once at app startup, stores in a module-level variable, and uses it to branch upload/download flows.

---

## 6. Transcription in S3 Mode

**`POST /api/transcribe`** currently expects a local file path and spawns a Python script.

In S3 mode:
- `filePath` is an S3 key
- Backend downloads the audio file from S3 to a local temp file
- Runs transcription script against the local temp file
- Returns result, cleans up temp file

If the inference server is on a separate GPU: transcription also needs to run on the GPU (it uses Whisper which needs GPU). This would go through the GPU Worker:
- Backend sends `POST /transcribe` to GPU Worker with `{ s3Key, language }`
- GPU Worker downloads from S3, runs transcription, returns result

---

## 7. Error Handling

- All S3 operations wrapped with clear error messages (bucket not found, access denied, key not found)
- Presigned URL expiry: 1 hour for uploads, 1 hour for downloads. Frontend retries with a fresh URL if a 403 is received
- GPU Worker connection failures: backend returns 503 with descriptive message
- S3 sync failures during training: GPU Worker emits error SSE event, backend relays to frontend

---

## 8. Configuration Summary

### Backend `server/.env` additions

```env
# Storage mode
STORAGE_MODE=s3

# S3 configuration
S3_BUCKET=my-voice-cloning-bucket
S3_REGION=ap-southeast-1
S3_PREFIX=prod/

# GPU Worker (only needed when STORAGE_MODE=s3 and GPU is separate)
GPU_WORKER_HOST=10.0.2.25
GPU_WORKER_PORT=3001
```

### GPU Worker `.env`

```env
GPT_SOVITS_ROOT=/opt/gpt-sovits
S3_BUCKET=my-voice-cloning-bucket
S3_REGION=ap-southeast-1
S3_PREFIX=prod/
WORKER_PORT=3001
```

### Frontend build-time env

```env
VITE_API_BASE_URL=https://api.echollect.yourcompany.com
VITE_APP_BASENAME=/
```

---

## 9. Out of Scope (Deferred)

- Multi-tenant S3 key isolation (per-user prefixes)
- Database for metadata (currently in-memory; S3 listing is sufficient for single-tenant)
- Authentication / authorization
- CloudFront CDN in front of S3 for audio delivery
- Automatic cleanup of old inference outputs in S3
- GPU Worker auto-scaling or queue management
