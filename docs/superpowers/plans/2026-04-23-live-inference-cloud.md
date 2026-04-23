# Live Inference Cloud Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live inference pipeline (record → transcribe → synthesize) work in S3 cloud mode by routing the audio blob directly from the browser to S3 via a presigned URL, then delegating transcription and synthesis to the Seoul GPU worker.

**Architecture:** In S3 mode, the browser requests a presigned S3 PUT URL from the backend, uploads the WebM blob directly to S3 (skipping the Singapore server entirely for audio data), then passes the resulting S3 key to the existing `/transcribe` endpoint. Transcription and synthesis already proxy to the GPU worker in S3 mode — only the upload step needs changes.

**Tech Stack:** Node.js + Express (ESM, server), React + Axios (client), AWS S3 presigned URLs (`@aws-sdk/s3-request-presigner` via existing `s3Storage.js`).

---

## File Map

| File | Change |
|------|--------|
| `server/src/routes/upload.js` | Add `POST /live/upload/presign` endpoint |
| `client/src/services/api.js` | Add S3-mode branch to `uploadLiveAudio()` |

No other files need changes. `useLiveSpeech.js`, the server transcribe route, the GPU worker transcribe route, and the TTS route all already handle S3 mode correctly.

---

### Task 1: Add presigned upload endpoint on the server

**Files:**
- Modify: `server/src/routes/upload.js`

**Context:** `upload.js` already imports `isS3Mode` and `generatePresignedPutUrl` from `s3Storage.js` but does not import Node's built-in `crypto` module. The new endpoint generates a UUID-keyed S3 path for each live recording, issues a presigned PUT URL, and returns both to the client. It is a no-op in local mode.

- [ ] **Step 1: Add the `crypto` import**

Open `server/src/routes/upload.js`. Add `crypto` to the existing Node built-in imports at the top of the file. The import block should look like this after the change:

```js
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { DATA_ROOT, REF_AUDIO_DIR, GPT_SOVITS_ROOT } from '../config.js';
import { isSafePathSegment, sanitizeFilename } from '../utils/paths.js';
import { isS3Mode, generatePresignedPutUrl, headObject } from '../services/s3Storage.js';
```

- [ ] **Step 2: Add the presign endpoint**

Append the following route **before** the `export default router;` line at the bottom of `server/src/routes/upload.js`:

```js
router.post('/live/upload/presign', async (_req, res) => {
  if (!isS3Mode()) {
    return res.status(400).json({ error: 'Only available in S3 mode' });
  }

  const key = `audio/live-uploads/${crypto.randomUUID()}.webm`;

  try {
    const { url } = await generatePresignedPutUrl(key, 'audio/webm');
    res.json({ url, key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Verify the server starts without errors**

```bash
cd server && npm run dev
```

Expected: server starts on port 3000 with no import or syntax errors.

- [ ] **Step 4: Smoke-test the endpoint in local mode**

```bash
curl -s -X POST http://localhost:3000/api/live/upload/presign
```

Expected response (local mode rejects it cleanly):
```json
{"error":"Only available in S3 mode"}
```

Status code should be 400. If you see a 404 or a crash, the route wasn't registered — check that the new block is above `export default router`.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/upload.js
git commit -m "feat: add POST /live/upload/presign endpoint for S3 mode"
```

---

### Task 2: Update `uploadLiveAudio()` on the client

**Files:**
- Modify: `client/src/services/api.js`

**Context:** `uploadLiveAudio()` currently always POSTs the blob as multipart to `/live/upload`. In S3 mode it needs to (1) get a presigned URL, (2) PUT the blob directly to S3, and (3) return `{ data: { filePath: key } }` — the same shape the local mode returns — so that `useLiveSpeech.js` can pass the key straight to `transcribeAudio()` unchanged.

`getStorageMode()` and `isS3Mode()` are already imported at the top of `api.js`.

- [ ] **Step 1: Replace `uploadLiveAudio()` with the branched version**

Find the current implementation in `client/src/services/api.js`:

```js
// Live recording upload — local mode only. S3 mode is not supported for this pipeline.
export async function uploadLiveAudio(blob) {
  const ext = blob.type.includes('ogg') ? '.ogg' : blob.type.includes('mp4') ? '.mp4' : '.webm';
  const formData = new FormData();
  formData.append('audio', blob, `live-recording${ext}`);
  return api.post('/live/upload', formData);
}
```

Replace it with:

```js
export async function uploadLiveAudio(blob) {
  await getStorageMode();

  if (isS3Mode()) {
    const presignRes = await api.post('/live/upload/presign');
    const { url, key } = presignRes.data;
    await fetch(url, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': 'audio/webm' },
    });
    return { data: { filePath: key } };
  }

  const ext = blob.type.includes('ogg') ? '.ogg' : blob.type.includes('mp4') ? '.mp4' : '.webm';
  const formData = new FormData();
  formData.append('audio', blob, `live-recording${ext}`);
  return api.post('/live/upload', formData);
}
```

- [ ] **Step 2: Verify the client builds without errors**

```bash
cd client && npm run dev
```

Expected: Vite compiles with no errors. Open `http://localhost:5173` and navigate to the Live page — the page should load normally.

- [ ] **Step 3: Manual end-to-end test in local mode**

With both the backend (`cd server && npm run dev`) and frontend (`cd client && npm run dev`) running locally:

1. Go to `/inference`, load a model and set a reference audio.
2. Navigate to `/live`.
3. Hold the mic button, say a sentence, release.
4. Confirm: transcript appears, then audio plays back in the cloned voice.

This confirms the local-mode path is untouched.

- [ ] **Step 4: Commit**

```bash
git add client/src/services/api.js
git commit -m "feat: add S3 presigned upload path to uploadLiveAudio"
```

---

### Task 3: End-to-end verification in S3 / cloud mode

**Files:** None — verification only.

**Context:** Deploy or test against the cloud environment (`STORAGE_MODE=s3`) with the Singapore backend and Seoul GPU worker. The full pipeline — presign → S3 upload → transcribe → TTS — must complete successfully.

- [ ] **Step 1: Deploy updated server to the Singapore EC2**

Push the branch and pull on the Singapore instance, then restart the server:

```bash
git push origin development-cloud
# on Singapore EC2:
git pull origin development-cloud && npm run dev   # or pm2 restart / however you manage the process
```

- [ ] **Step 2: Verify the presign endpoint returns a real S3 URL**

```bash
curl -s -X POST https://<your-backend-domain>/api/live/upload/presign
```

Expected: a JSON object with a `url` (long S3 presigned URL starting with `https://`) and a `key` like `audio/live-uploads/<uuid>.webm`.

If you get `{"error":"Only available in S3 mode"}`, `STORAGE_MODE` is not set to `s3` on the backend — check the `.env`.

- [ ] **Step 3: End-to-end live inference test**

Open the CloudFront URL in a browser:

1. Go to `/inference`, confirm a model is loaded and a reference audio is set.
2. Navigate to `/live`.
3. Hold the mic button, say a sentence, release.
4. Watch the network tab:
   - A `POST /api/live/upload/presign` call should return `{ url, key }`.
   - A `PUT` to the S3 URL should return HTTP 200.
   - A `POST /api/transcribe` should return `{ text, language }`.
   - A `POST /api/live/tts-sentence` should return a WAV blob.
5. Confirm the cloned audio plays back.

- [ ] **Step 4: Verify S3 object was created**

In the AWS console or via CLI, check that `audio/live-uploads/<uuid>.webm` exists in your S3 bucket. This confirms the presigned PUT succeeded.

```bash
aws s3 ls s3://<your-bucket>/audio/live-uploads/ --region ap-northeast-2
```

- [ ] **Step 5: Commit any fixes, then tag the feature complete**

```bash
git add -p   # stage only relevant fixes
git commit -m "fix: <describe any fix>"
```
