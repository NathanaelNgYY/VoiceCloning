# Live Inference — Cloud (S3 Mode) Support

**Date:** 2026-04-23
**Branch:** development-cloud
**Status:** Approved

## Problem

The live inference pipeline (record → transcribe → synthesize) only works in local mode. In S3 mode (CloudFront + S3 + Singapore backend + Seoul GPU worker), the upload and transcription steps break:

- `POST /live/upload` saves to the backend's local disk and runs ffmpeg there — the GPU worker can never access that path.
- `uploadLiveAudio()` in the client has an explicit "S3 mode not supported" comment.
- `POST /transcribe` in S3 mode expects an S3 key, but receives a local backend path.

The synthesize step (`POST /live/tts-sentence`) already works in S3 mode because `inferenceServer.synthesize()` internally proxies to `gpuWorkerClient.synthesize()`.

## Architecture

**Infrastructure:** CloudFront (frontend) · S3 (storage) · Singapore EC2 (backend, port 3000) · Seoul EC2 (GPU worker, port 3001, GPU).

**Chosen approach:** Direct browser → S3 presigned upload, bypassing the Singapore backend for audio data entirely. Aligns with the existing training audio and ref audio upload patterns.

## Data Flow (S3 mode)

```
Browser
  1. POST /api/live/upload/presign
        └─→ backend generates presigned S3 PUT URL
        ←── { url, key }   (key = audio/live-uploads/<uuid>.webm)

  2. PUT <presigned-url>   (WebM blob direct to S3 — no Singapore hop)

  3. POST /api/transcribe { filePath: key, language: 'en' }
        └─→ backend → gpuWorkerClient.transcribe(s3Key, language)
                          └─→ GPU worker: S3 download → Whisper → { text, language }

  4. POST /api/live/tts-sentence { text, ref_audio_path, ... }
        └─→ backend → inferenceServer.synthesize() → gpuWorkerClient.synthesize()
                          └─→ GPU worker: TTS → WAV buffer
        ←── WAV blob

Browser plays audio
```

Steps 3 and 4 require no code changes — they already handle S3 mode correctly.

## Changes

### 1. `server/src/routes/upload.js` — new endpoint

```
POST /api/live/upload/presign
```

- Returns 400 in local mode (not applicable).
- Generates a UUID, builds S3 key `audio/live-uploads/<uuid>.webm`.
- Calls `generatePresignedPutUrl(key, 'audio/webm')`.
- Returns `{ url, key }`.

The existing `POST /live/upload` route is unchanged (still handles local mode).

### 2. `client/src/services/api.js` — branch `uploadLiveAudio()`

S3 mode:
1. `POST /api/live/upload/presign` → `{ url, key }`
2. `PUT url` with the blob (`Content-Type: audio/webm`)
3. Return `{ data: { filePath: key } }` — same shape as local mode response

Local mode: unchanged.

### 3. No changes needed

- `useLiveSpeech.js` — `runPostReleasePipeline` already reads `uploadRes.data.filePath` and passes it to `transcribeAudio()`.
- `server/src/routes/inference.js` `/transcribe` — already delegates to `gpuWorkerClient.transcribe(s3Key)` in S3 mode.
- `gpu-worker/src/routes/transcribe.js` — already accepts S3 key, downloads, runs Whisper (which handles WebM via its internal ffmpeg), cleans up temp file.
- `gpu-worker/src/routes/inference.js` `/inference/tts` — unchanged.

## Out of Scope

- Cleanup of `audio/live-uploads/` S3 objects. These are small (~100 KB each) and short-lived. Add an S3 lifecycle rule to expire after 1 day as a follow-up.
- Streaming synthesis (Approach C) — different architecture, future work.
