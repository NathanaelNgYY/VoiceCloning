# TTS Word Timestamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add word-level timestamp alignment to TTS output so the frontend can highlight the current spoken word in real time on both InferencePage (batch) and LivePage (live chat).

**Architecture:** GPT-SoVITS synthesizes WAV, then faster-whisper runs on the output to produce `[{word, start, end}]` timestamps. Timestamps flow through the existing HTTP paths as a JSON response header (`X-Word-Timestamps`) and as part of the `inference-complete` SSE event. The frontend renders words as `<span>` elements and highlights the active one via `timeupdate`.

**Tech Stack:** Node.js + Express (gpu-inference-worker), Python + faster-whisper, Lambda (proxy layer), React + Tailwind CSS (client).

---

## File Map

### Created
- `gpu-inference-worker/scripts/align_words.py` — Python script, runs faster-whisper, prints JSON to stdout
- `gpu-inference-worker/src/services/wordAligner.js` — Node.js wrapper that spawns `align_words.py`
- `client/src/lib/wordTimestamps.js` — Pure function: binary search for active word index
- `client/src/components/WordTimestampPlayer.jsx` — Audio player with highlighted transcript above it

### Modified
- `gpu-inference-worker/src/services/longTextInference.js` — Call `alignWords` after synthesis; include in return values
- `gpu-inference-worker/src/routes/inference.js` — Set `X-Word-Timestamps` response header on `/inference` and `/inference/tts`
- `gpu-inference-worker/src/index.js` — Expose `X-Word-Timestamps` in CORS `exposedHeaders`
- `lambda/shared/cors.js` — Add `Access-Control-Expose-Headers: X-Word-Timestamps`
- `lambda/shared/gpuWorker.js` — Capture `X-Word-Timestamps` header in `gpuPostBinary` and `inferencePostBinary`
- `lambda/live/index.js` — Forward `X-Word-Timestamps` header to client
- `lambda/inference/index.js` — Forward `X-Word-Timestamps` header in `binaryWav` helper
- `client/src/hooks/useInferenceSSE.js` — Add `wordTimestamps` + `transcript` state; capture from `inference-complete` event
- `client/src/services/api.js` — `synthesize` and `synthesizeSentence` return `{blob, wordTimestamps}` instead of Blob
- `client/src/pages/InferencePage.jsx` — Replace `AudioPlayer` with `WordTimestampPlayer`
- `client/src/hooks/useLiveSpeech.js` — Destructure `{blob, wordTimestamps}` from synthesize calls; patch onto messages
- `client/src/pages/LivePage.jsx` — `ChatBubble` shows highlighted transcript when playing

---

## Task 1: Python alignment script (`align_words.py`)

**Files:**
- Create: `gpu-inference-worker/scripts/align_words.py`

- [ ] **Step 1: Create the scripts directory and write the script**

  Create `gpu-inference-worker/scripts/align_words.py` with this exact content:

  ```python
  import sys
  import json


  def main():
      if len(sys.argv) < 2:
          print("Usage: align_words.py <wav_path> [model_size]", file=sys.stderr)
          sys.exit(1)

      wav_path = sys.argv[1]
      model_size = sys.argv[2] if len(sys.argv) > 2 else "tiny"

      from faster_whisper import WhisperModel

      model = WhisperModel(model_size, device="auto", compute_type="int8")
      segments, _ = model.transcribe(wav_path, word_timestamps=True)

      words = []
      for segment in segments:
          for word in (segment.words or []):
              words.append({
                  "word": word.word.strip(),
                  "start": round(float(word.start), 3),
                  "end": round(float(word.end), 3),
              })

      print(json.dumps(words))


  if __name__ == "__main__":
      main()
  ```

- [ ] **Step 2: Manually verify the script works**

  Inside the gpu-inference-worker Docker container or dev environment (replace paths as needed):

  ```bash
  python gpu-inference-worker/scripts/align_words.py /path/to/some/test.wav tiny
  ```

  Expected stdout: a JSON array like `[{"word": "Hello", "start": 0.12, "end": 0.45}, ...]`
  Expected: exit code 0, nothing on stderr except model loading logs.

- [ ] **Step 3: Commit**

  ```bash
  git add gpu-inference-worker/scripts/align_words.py
  git commit -m "feat: add align_words.py — faster-whisper post-synthesis word alignment"
  ```

---

## Task 2: Node.js word aligner service (`wordAligner.js`)

**Files:**
- Create: `gpu-inference-worker/src/services/wordAligner.js`

- [ ] **Step 1: Write the service**

  Create `gpu-inference-worker/src/services/wordAligner.js`:

  ```js
  import { spawn } from 'child_process';
  import { fileURLToPath } from 'url';
  import { PYTHON_EXEC, buildPythonEnv } from '../config.js';

  const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/align_words.py', import.meta.url));
  const TIMEOUT_MS = 30_000;

  export async function alignWords(wavPath) {
    return new Promise((resolve) => {
      let stdout = '';
      let timedOut = false;

      const proc = spawn(PYTHON_EXEC, [SCRIPT_PATH, wavPath, 'tiny'], {
        env: buildPythonEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
        resolve(null);
      }, TIMEOUT_MS);

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { process.stderr.write(`[wordAligner] ${data}`); });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (timedOut) return;
        if (code !== 0 || !stdout.trim()) { resolve(null); return; }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve(null);
        }
      });

      proc.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add gpu-inference-worker/src/services/wordAligner.js
  git commit -m "feat: add wordAligner.js — Node.js wrapper for align_words.py"
  ```

---

## Task 3: `longTextInference.js` — add alignment to both synthesis paths

**Files:**
- Modify: `gpu-inference-worker/src/services/longTextInference.js`

This file has two synthesis functions. Both need to call `alignWords` and return the result.

- [ ] **Step 1: Add imports**

  At the top of `longTextInference.js`, add two imports after the existing import block:

  ```js
  import os from 'os';
  import { alignWords } from './wordAligner.js';
  ```

  The existing imports start at line 1 and end at line 8. The file currently imports:
  ```js
  import crypto from 'crypto';
  import fs from 'fs';
  import path from 'path';
  import { inferenceServer } from './inferenceServer.js';
  import { sseManager } from './sseManager.js';
  import { inferenceState } from './inferenceState.js';
  import { LOCAL_TEMP_ROOT } from '../config.js';
  import { uploadBuffer } from './s3Storage.js';
  ```

  Add `import os from 'os';` and `import { alignWords } from './wordAligner.js';` after line 8.

- [ ] **Step 2: Update `synthesizeLongTextStreaming` to call `alignWords` and include result in SSE**

  In `synthesizeLongTextStreaming`, find this block (around line 1088–1102):

  ```js
      const finalPath = path.join(sessionDir, 'final.wav');
      fs.writeFileSync(finalPath, finalBuffer);

      // Upload to S3 for persistence (non-blocking — don't fail the session on S3 error)
      let s3Key = `audio/output/${sessionId}/final.wav`;
      uploadBuffer(s3Key, finalBuffer, 'audio/wav').catch((err) => {
        console.error(`[inference] Failed to upload result to S3: ${err.message}`);
      });

      const totalDuration = (Date.now() - startTime) / 1000;
      sseManager.send(sessionId, 'inference-complete', {
        totalChunks: chunks.length,
        totalDurationSec: parseFloat(totalDuration.toFixed(2)),
        ...(s3Key ? { s3Key } : {}),
      });
      inferenceState.setComplete();
  ```

  Replace it with:

  ```js
      const finalPath = path.join(sessionDir, 'final.wav');
      fs.writeFileSync(finalPath, finalBuffer);

      const wordTimestamps = await alignWords(finalPath);

      // Upload to S3 for persistence (non-blocking — don't fail the session on S3 error)
      let s3Key = `audio/output/${sessionId}/final.wav`;
      uploadBuffer(s3Key, finalBuffer, 'audio/wav').catch((err) => {
        console.error(`[inference] Failed to upload result to S3: ${err.message}`);
      });

      const totalDuration = (Date.now() - startTime) / 1000;
      sseManager.send(sessionId, 'inference-complete', {
        totalChunks: chunks.length,
        totalDurationSec: parseFloat(totalDuration.toFixed(2)),
        ...(s3Key ? { s3Key } : {}),
        wordTimestamps: wordTimestamps ?? null,
      });
      inferenceState.setComplete();
  ```

- [ ] **Step 3: Update `synthesizeLongText` to call `alignWords` and include in return value**

  In `synthesizeLongText`, find the final return at the bottom of the function (around line 1162–1166):

  ```js
    const finalBuffer = buffers.length === 1
      ? buffers[0]
      : concatWavs(buffers, pauses, fades);

    return { audioBuffer: finalBuffer, chunks: metadata };
  }
  ```

  Replace it with:

  ```js
    const finalBuffer = buffers.length === 1
      ? buffers[0]
      : concatWavs(buffers, pauses, fades);

    let wordTimestamps = null;
    const alignTempPath = path.join(os.tmpdir(), `align_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
    try {
      fs.writeFileSync(alignTempPath, finalBuffer);
      wordTimestamps = await alignWords(alignTempPath);
    } finally {
      try { fs.unlinkSync(alignTempPath); } catch { /* ignore */ }
    }

    return { audioBuffer: finalBuffer, chunks: metadata, wordTimestamps };
  }
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add gpu-inference-worker/src/services/longTextInference.js
  git commit -m "feat: run word alignment after synthesis in longTextInference"
  ```

---

## Task 4: `routes/inference.js` + `src/index.js` — expose header + CORS

**Files:**
- Modify: `gpu-inference-worker/src/routes/inference.js`
- Modify: `gpu-inference-worker/src/index.js`

- [ ] **Step 1: Add `alignWords` import to `routes/inference.js`**

  At the top of `gpu-inference-worker/src/routes/inference.js`, add this import after the existing service imports:

  ```js
  import { alignWords } from '../services/wordAligner.js';
  ```

  The existing imports at the top are:
  ```js
  import fs from 'fs';
  import path from 'path';
  import crypto from 'crypto';
  import { Router } from 'express';
  import { LOCAL_TEMP_ROOT } from '../config.js';
  import { downloadFile } from '../services/s3Sync.js';
  import { inferenceServer } from '../services/inferenceServer.js';
  import { activityState } from '../services/activityState.js';
  import {
    synthesizeLongText,
    synthesizeLongTextStreaming,
    cancelSession,
  } from '../services/longTextInference.js';
  import { inferenceState } from '../services/inferenceState.js';
  import { sseManager } from '../services/sseManager.js';
  ```

  Add the `alignWords` import after line 15 (after the `sseManager` import).

- [ ] **Step 2: Update `POST /inference/tts` to call `alignWords` and set header**

  Find the `router.post('/inference/tts', ...)` handler (lines 161–180). Find this block inside it:

  ```js
      const audioBuffer = await inferenceServer.synthesize(resolvedParams);
      activityState.mark();
      res.set({
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length,
      });
      res.send(audioBuffer);
  ```

  Replace it with:

  ```js
      const audioBuffer = await inferenceServer.synthesize(resolvedParams);
      activityState.mark();

      let wordTimestamps = null;
      const ttsTempPath = path.join(LOCAL_TEMP_ROOT, `align_tts_${Date.now()}.wav`);
      try {
        fs.mkdirSync(path.dirname(ttsTempPath), { recursive: true });
        fs.writeFileSync(ttsTempPath, audioBuffer);
        wordTimestamps = await alignWords(ttsTempPath);
      } finally {
        try { fs.unlinkSync(ttsTempPath); } catch { /* ignore */ }
      }

      res.set({
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length,
        'X-Word-Timestamps': JSON.stringify(wordTimestamps),
      });
      res.send(audioBuffer);
  ```

- [ ] **Step 3: Update `POST /inference` (batch) to forward `wordTimestamps` in header**

  Find the `router.post('/inference', ...)` handler (lines 182–218). Find this block:

  ```js
      const { audioBuffer, chunks } = await synthesizeLongText(resolvedParams, {
        maxChunkLength: 280,
        maxSentencesPerChunk: 3,
        chunkJoinPauseMs: 120,
        retryCount: 2,
      });
      activityState.mark();

      res.set({
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length,
        'X-Chunk-Count': String(chunks.length),
        'X-Chunk-Retries': String(chunks.reduce((sum, chunk) => sum + Math.max(0, chunk.attempts - 1), 0)),
      });
      res.send(audioBuffer);
  ```

  Replace it with:

  ```js
      const { audioBuffer, chunks, wordTimestamps } = await synthesizeLongText(resolvedParams, {
        maxChunkLength: 280,
        maxSentencesPerChunk: 3,
        chunkJoinPauseMs: 120,
        retryCount: 2,
      });
      activityState.mark();

      res.set({
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length,
        'X-Chunk-Count': String(chunks.length),
        'X-Chunk-Retries': String(chunks.reduce((sum, chunk) => sum + Math.max(0, chunk.attempts - 1), 0)),
        'X-Word-Timestamps': JSON.stringify(wordTimestamps ?? null),
      });
      res.send(audioBuffer);
  ```

- [ ] **Step 4: Add `exposedHeaders` to CORS config in `src/index.js`**

  In `gpu-inference-worker/src/index.js`, find:

  ```js
  app.use(cors({ origin: buildCorsOriginOption(CORS_ORIGIN) }));
  ```

  Replace with:

  ```js
  app.use(cors({ origin: buildCorsOriginOption(CORS_ORIGIN), exposedHeaders: ['X-Word-Timestamps'] }));
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add gpu-inference-worker/src/routes/inference.js gpu-inference-worker/src/index.js
  git commit -m "feat: expose X-Word-Timestamps header on inference routes"
  ```

---

## Task 5: Lambda proxy — forward `X-Word-Timestamps`

**Files:**
- Modify: `lambda/shared/cors.js`
- Modify: `lambda/shared/gpuWorker.js`
- Modify: `lambda/live/index.js`
- Modify: `lambda/inference/index.js`

- [ ] **Step 1: Add `Access-Control-Expose-Headers` to `lambda/shared/cors.js`**

  In `lambda/shared/cors.js`, find the `buildCorsHeaders` function:

  ```js
  export function buildCorsHeaders(eventOrOrigin) {
    return {
      'Access-Control-Allow-Origin': resolveCorsOrigin(getRequestOrigin(eventOrOrigin)),
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-amz-content-sha256',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      Vary: 'Origin',
    };
  }
  ```

  Replace with:

  ```js
  export function buildCorsHeaders(eventOrOrigin) {
    return {
      'Access-Control-Allow-Origin': resolveCorsOrigin(getRequestOrigin(eventOrOrigin)),
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-amz-content-sha256',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Expose-Headers': 'X-Word-Timestamps',
      Vary: 'Origin',
    };
  }
  ```

  Also find the `corsHeaders` export:

  ```js
  export const corsHeaders = {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-amz-content-sha256',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    Vary: 'Origin',
  };
  ```

  Replace with:

  ```js
  export const corsHeaders = {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-amz-content-sha256',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Expose-Headers': 'X-Word-Timestamps',
    Vary: 'Origin',
  };
  ```

- [ ] **Step 2: Capture `X-Word-Timestamps` in `gpuPostBinary` and `inferencePostBinary`**

  In `lambda/shared/gpuWorker.js`, find `gpuPostBinary`:

  ```js
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
  ```

  Replace with:

  ```js
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
      wordTimestamps: response.headers.get('x-word-timestamps') || null,
    };
  }
  ```

  Find `inferencePostBinary`:

  ```js
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

  Replace with:

  ```js
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
      wordTimestamps: response.headers.get('x-word-timestamps') || null,
    };
  }
  ```

- [ ] **Step 3: Forward `X-Word-Timestamps` in `lambda/live/index.js`**

  In `lambda/live/index.js`, find:

  ```js
      const { buffer, contentType } = await gpuPostBinary('/inference/tts', {
        ...body,
        text: `${body.text.trim()} `,
        text_split_method: 'cut0',
        batch_size: 1,
        streaming_mode: false,
        split_bucket: true,
        parallel_infer: false,
        fragment_interval: 0.1,
      });

      return {
        statusCode: 200,
        isBase64Encoded: true,
        headers: {
          'Content-Type': contentType || 'audio/wav',
          'Content-Length': String(buffer.length),
          ...corsHeaders,
        },
        body: buffer.toString('base64'),
      };
  ```

  Replace with:

  ```js
      const { buffer, contentType, wordTimestamps } = await gpuPostBinary('/inference/tts', {
        ...body,
        text: `${body.text.trim()} `,
        text_split_method: 'cut0',
        batch_size: 1,
        streaming_mode: false,
        split_bucket: true,
        parallel_infer: false,
        fragment_interval: 0.1,
      });

      return {
        statusCode: 200,
        isBase64Encoded: true,
        headers: {
          'Content-Type': contentType || 'audio/wav',
          'Content-Length': String(buffer.length),
          'X-Word-Timestamps': wordTimestamps || 'null',
          ...corsHeaders,
        },
        body: buffer.toString('base64'),
      };
  ```

- [ ] **Step 4: Forward `X-Word-Timestamps` in `lambda/inference/index.js`**

  In `lambda/inference/index.js`, find the `binaryWav` helper:

  ```js
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
  ```

  Replace with:

  ```js
  function binaryWav(buffer, contentType = 'audio/wav', wordTimestamps = null) {
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'X-Word-Timestamps': wordTimestamps || 'null',
        ...corsHeaders,
      },
      body: buffer.toString('base64'),
    };
  }
  ```

  Find the handler block for `POST /inference`:

  ```js
      if (method === 'POST' && routePath.endsWith('/inference')) {
        if (!body.text) return err(400, 'text is required');
        if (!body.ref_audio_path) return err(400, 'ref_audio_path is required');
        const { buffer, contentType } = await inferencePostBinary('/inference', body);
        return binaryWav(buffer, contentType);
      }
  ```

  Replace with:

  ```js
      if (method === 'POST' && routePath.endsWith('/inference')) {
        if (!body.text) return err(400, 'text is required');
        if (!body.ref_audio_path) return err(400, 'ref_audio_path is required');
        const { buffer, contentType, wordTimestamps } = await inferencePostBinary('/inference', body);
        return binaryWav(buffer, contentType, wordTimestamps);
      }
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add lambda/shared/cors.js lambda/shared/gpuWorker.js lambda/live/index.js lambda/inference/index.js
  git commit -m "feat: lambda proxy forwards X-Word-Timestamps header and exposes it via CORS"
  ```

---

## Task 6: Client utility + `WordTimestampPlayer` component

**Files:**
- Create: `client/src/lib/wordTimestamps.js`
- Create: `client/src/components/WordTimestampPlayer.jsx`

- [ ] **Step 1: Create `wordTimestamps.js` utility**

  Create `client/src/lib/wordTimestamps.js`:

  ```js
  export function findActiveWordIndex(wordTimestamps, currentTime) {
    if (!Array.isArray(wordTimestamps) || wordTimestamps.length === 0) return -1;
    let lo = 0;
    let hi = wordTimestamps.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const { start, end } = wordTimestamps[mid];
      if (currentTime < start) {
        hi = mid - 1;
      } else if (currentTime >= end) {
        lo = mid + 1;
      } else {
        return mid;
      }
    }
    return -1;
  }
  ```

- [ ] **Step 2: Manually verify the binary search logic**

  Paste this into a browser console or Node REPL to confirm:

  ```js
  function findActiveWordIndex(wordTimestamps, currentTime) {
    if (!Array.isArray(wordTimestamps) || wordTimestamps.length === 0) return -1;
    let lo = 0;
    let hi = wordTimestamps.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const { start, end } = wordTimestamps[mid];
      if (currentTime < start) {
        hi = mid - 1;
      } else if (currentTime >= end) {
        lo = mid + 1;
      } else {
        return mid;
      }
    }
    return -1;
  }

  const ts = [
    { word: 'Hello', start: 0.1, end: 0.4 },
    { word: 'world', start: 0.5, end: 0.9 },
    { word: 'foo', start: 1.0, end: 1.3 },
  ];

  console.assert(findActiveWordIndex(ts, 0.0) === -1, 'before first word');
  console.assert(findActiveWordIndex(ts, 0.1) === 0, 'at start of first word');
  console.assert(findActiveWordIndex(ts, 0.25) === 0, 'mid first word');
  console.assert(findActiveWordIndex(ts, 0.4) === -1, 'between words (end exclusive)');
  console.assert(findActiveWordIndex(ts, 0.5) === 1, 'second word');
  console.assert(findActiveWordIndex(ts, 1.0) === 2, 'third word');
  console.assert(findActiveWordIndex(ts, 1.3) === -1, 'after last word');
  console.assert(findActiveWordIndex([], 0.5) === -1, 'empty array');
  console.assert(findActiveWordIndex(null, 0.5) === -1, 'null array');
  console.log('All assertions passed');
  ```

  Expected: `All assertions passed` with no errors.

- [ ] **Step 3: Create `WordTimestampPlayer.jsx`**

  Create `client/src/components/WordTimestampPlayer.jsx`:

  ```jsx
  import React, { useEffect, useRef, useState } from 'react';
  import { findActiveWordIndex } from '@/lib/wordTimestamps';

  export default function WordTimestampPlayer({ audioBlob, wordTimestamps, transcript, showDownload = true }) {
    const audioRef = useRef(null);
    const [audioUrl, setAudioUrl] = useState(null);
    const [activeIndex, setActiveIndex] = useState(-1);

    useEffect(() => {
      if (!audioBlob) return;
      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);
      return () => URL.revokeObjectURL(url);
    }, [audioBlob]);

    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;
      const onTimeUpdate = () => setActiveIndex(findActiveWordIndex(wordTimestamps, audio.currentTime));
      const onReset = () => setActiveIndex(-1);
      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('ended', onReset);
      audio.addEventListener('pause', onReset);
      return () => {
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('ended', onReset);
        audio.removeEventListener('pause', onReset);
      };
    }, [wordTimestamps]);

    if (!audioBlob) return null;

    const hasTimestamps = Array.isArray(wordTimestamps) && wordTimestamps.length > 0;
    const hasTranscript = Boolean(transcript?.trim());

    return (
      <div className="space-y-3">
        {(hasTimestamps || hasTranscript) && (
          <div className="rounded-[18px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-7">
            {hasTimestamps ? (
              wordTimestamps.map((item, i) => (
                <React.Fragment key={i}>
                  <span className={i === activeIndex ? 'rounded-sm bg-yellow-200 px-0.5' : undefined}>
                    {item.word}
                  </span>
                  {i < wordTimestamps.length - 1 && ' '}
                </React.Fragment>
              ))
            ) : (
              <span className="text-muted-foreground">{transcript}</span>
            )}
          </div>
        )}
        <audio ref={audioRef} src={audioUrl} controls className="w-full" />
        {showDownload && audioUrl && (
          <a
            href={audioUrl}
            download="synthesis.wav"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Download WAV
          </a>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add client/src/lib/wordTimestamps.js client/src/components/WordTimestampPlayer.jsx
  git commit -m "feat: add wordTimestamps utility and WordTimestampPlayer component"
  ```

---

## Task 7: Client batch inference — `useInferenceSSE.js` + `InferencePage.jsx`

**Files:**
- Modify: `client/src/hooks/useInferenceSSE.js`
- Modify: `client/src/pages/InferencePage.jsx`

- [ ] **Step 1: Update `useInferenceSSE.js` to capture `wordTimestamps` and `transcript`**

  Replace the entire content of `client/src/hooks/useInferenceSSE.js` with:

  ```js
  import { useState, useEffect, useRef, useCallback } from 'react';
  import { connectInferenceSSE } from '../services/sse.js';

  export function useInferenceSSE() {
    const [status, setStatus] = useState('idle');
    const [totalChunks, setTotalChunks] = useState(0);
    const [completedChunks, setCompletedChunks] = useState(0);
    const [currentChunkText, setCurrentChunkText] = useState('');
    const [error, setError] = useState(null);
    const [wordTimestamps, setWordTimestamps] = useState(null);
    const [transcript, setTranscript] = useState('');
    const esRef = useRef(null);

    const hydrate = useCallback((initialState = {}) => {
      const {
        initialStatus = 'idle',
        initialTotalChunks = 0,
        initialCompletedChunks = 0,
        initialCurrentChunkText = '',
        initialError = null,
      } = initialState;

      setStatus(initialStatus);
      setTotalChunks(initialTotalChunks);
      setCompletedChunks(initialCompletedChunks);
      setCurrentChunkText(initialCurrentChunkText);
      setError(initialError);
      setWordTimestamps(null);
      setTranscript('');
    }, []);

    const connect = useCallback((sessionId, initialState = {}) => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

      hydrate({
        initialStatus: initialState.initialStatus || 'waiting',
        initialTotalChunks: initialState.initialTotalChunks || 0,
        initialCompletedChunks: initialState.initialCompletedChunks || 0,
        initialCurrentChunkText: initialState.initialCurrentChunkText || '',
        initialError: initialState.initialError || null,
      });

      esRef.current = connectInferenceSSE(sessionId, {
        onStart(data) {
          setStatus('generating');
          setTotalChunks(data.totalChunks);
          setTranscript((data.chunks || []).map((c) => c.text).join(' '));
        },
        onChunkStart(data) {
          setStatus('generating');
          setCurrentChunkText(data.text);
        },
        onChunkComplete(data) {
          setCompletedChunks(data.index + 1);
        },
        onComplete(data) {
          setStatus('complete');
          setCurrentChunkText('');
          setWordTimestamps(data?.wordTimestamps ?? null);
        },
        onError(data) {
          const isCancelled = data?.message?.includes('cancelled');
          setStatus(isCancelled ? 'cancelled' : 'error');
          setError(data?.message || 'Unknown error');
          setCurrentChunkText('');
        },
      });
    }, []);

    const disconnect = useCallback(() => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    }, []);

    const reset = useCallback(() => {
      disconnect();
      hydrate();
    }, [disconnect, hydrate]);

    useEffect(() => {
      return () => disconnect();
    }, [disconnect]);

    return {
      status, totalChunks, completedChunks, currentChunkText, error,
      wordTimestamps, transcript,
      connect, disconnect, hydrate, reset,
    };
  }
  ```

- [ ] **Step 2: Update `InferencePage.jsx` to use `WordTimestampPlayer`**

  In `client/src/pages/InferencePage.jsx`, add the import at the top (line 2, after the existing `AudioPlayer` import):

  ```js
  import WordTimestampPlayer from '../components/WordTimestampPlayer.jsx';
  ```

  Find the line (around line 1781):

  ```jsx
          <AudioPlayer audioBlob={audioBlob} />
  ```

  Replace with:

  ```jsx
          <WordTimestampPlayer
            audioBlob={audioBlob}
            wordTimestamps={inference.wordTimestamps}
            transcript={inference.transcript}
          />
  ```

  The `AudioPlayer` import on line 2 can stay — it may be used elsewhere. Do not delete it.

- [ ] **Step 3: Manually smoke test the InferencePage**

  Start the dev server and generate a short TTS clip:
  1. Go to `InferencePage`
  2. Set up a voice model and reference audio
  3. Enter text like "Hello world, this is a test" and click Generate
  4. When generation completes, the transcript should appear above the audio player
  5. Click play — words should highlight one by one as speech plays
  6. If `wordTimestamps` is null (alignment failed), the plain transcript from `inference.transcript` should appear with no highlighting

- [ ] **Step 4: Commit**

  ```bash
  git add client/src/hooks/useInferenceSSE.js client/src/pages/InferencePage.jsx
  git commit -m "feat: wire word timestamps into InferencePage via useInferenceSSE + WordTimestampPlayer"
  ```

---

## Task 8: Client `api.js` — `synthesize` and `synthesizeSentence` return `{blob, wordTimestamps}`

**Files:**
- Modify: `client/src/services/api.js`

> **Note:** This change breaks the callers of `synthesize` and `synthesizeSentence`. All callers must be updated in this same task before committing, or the app will break. Complete Steps 1–4 before committing.

- [ ] **Step 1: Update `synthesize` in `api.js`**

  Find the `synthesize` function (lines 173–191):

  ```js
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
  ```

  Replace with:

  ```js
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

    const blob = new Blob([res.data], { type: 'audio/wav' });
    const wordTimestampsHeader = res.headers['x-word-timestamps'];
    let wordTimestamps = null;
    try {
      if (wordTimestampsHeader) wordTimestamps = JSON.parse(wordTimestampsHeader);
    } catch { /* ignore malformed header */ }
    return { blob, wordTimestamps };
  }
  ```

- [ ] **Step 2: Update `synthesizeSentence` in `api.js`**

  Find the `synthesizeSentence` function (lines 193–211):

  ```js
  export async function synthesizeSentence(params) {
    const res = await api.post('/live/tts-sentence', params, {
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
  ```

  Replace with:

  ```js
  export async function synthesizeSentence(params) {
    const res = await api.post('/live/tts-sentence', params, {
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

    const blob = new Blob([res.data], { type: 'audio/wav' });
    const wordTimestampsHeader = res.headers['x-word-timestamps'];
    let wordTimestamps = null;
    try {
      if (wordTimestampsHeader) wordTimestamps = JSON.parse(wordTimestampsHeader);
    } catch { /* ignore malformed header */ }
    return { blob, wordTimestamps };
  }
  ```

- [ ] **Step 3: Update `useLiveSpeech.js` to destructure `{blob, wordTimestamps}` from synthesize calls**

  In `client/src/hooks/useLiveSpeech.js`:

  Find `synthesizeFullAssistantReply` (around line 361). Find this block:

  ```js
      try {
        const blob = await synthesizeWithRetry(buildLiveReplyParams(text, refParams, liveLanguage));
        if (
          isCancelledRef.current ||
          runId !== runIdRef.current ||
          cancelledReplyIdsRef.current.has(messageId)
        ) {
          return;
        }

        const url = URL.createObjectURL(blob);
        patchMessage(messageId, { status: 'ready', audioUrl: url, error: null });
  ```

  Replace with:

  ```js
      try {
        const { blob, wordTimestamps } = await synthesizeWithRetry(buildLiveReplyParams(text, refParams, liveLanguage));
        if (
          isCancelledRef.current ||
          runId !== runIdRef.current ||
          cancelledReplyIdsRef.current.has(messageId)
        ) {
          return;
        }

        const url = URL.createObjectURL(blob);
        patchMessage(messageId, { status: 'ready', audioUrl: url, wordTimestamps, error: null });
  ```

  Find `synthesizePhraseAssistantReply` (around line 403). Find this block inside the for-loop:

  ```js
        const blob = await synthesizeSentenceWithRetry(
          buildLiveSentenceParams(phrases[index], refParams, liveLanguage)
        );

        if (
          isCancelledRef.current ||
          runId !== runIdRef.current ||
          cancelledReplyIdsRef.current.has(messageId)
        ) {
          return;
        }

        const url = URL.createObjectURL(blob);
        patchAudioPart(messageId, partId, { status: 'ready', audioUrl: url, error: null });
  ```

  Replace with:

  ```js
        const { blob, wordTimestamps } = await synthesizeSentenceWithRetry(
          buildLiveSentenceParams(phrases[index], refParams, liveLanguage)
        );

        if (
          isCancelledRef.current ||
          runId !== runIdRef.current ||
          cancelledReplyIdsRef.current.has(messageId)
        ) {
          return;
        }

        const url = URL.createObjectURL(blob);
        patchAudioPart(messageId, partId, { status: 'ready', audioUrl: url, wordTimestamps, error: null });
  ```

- [ ] **Step 4: Update `LivePage.jsx` — ChatBubble word highlighting**

  In `client/src/pages/LivePage.jsx`, add these imports near the top (after the existing React import):

  ```js
  import { findActiveWordIndex } from '@/lib/wordTimestamps';
  ```

  Find the `ChatBubble` function (starts at line 72). Replace the entire `ChatBubble` component with:

  ```jsx
  function ChatBubble({ message, selected, onPlay, audioRef }) {
    const isUser = message.role === 'user';
    const readyParts = (message.audioParts || []).filter((part) => part.audioUrl);
    const hasVoice = !isUser && (Boolean(message.audioUrl) || readyParts.length > 0);
    const isBusy = ['thinking', 'generating_voice', 'transcribing', 'listening'].includes(message.status);
    const [activeWordIndex, setActiveWordIndex] = React.useState(-1);

    const wordTimestamps = !isUser ? (message.wordTimestamps || null) : null;
    const isPlaying = selected && !isUser;

    React.useEffect(() => {
      const audio = audioRef?.current;
      if (!audio || !isPlaying || !wordTimestamps) {
        setActiveWordIndex(-1);
        return;
      }
      const onTimeUpdate = () => setActiveWordIndex(findActiveWordIndex(wordTimestamps, audio.currentTime));
      const onReset = () => setActiveWordIndex(-1);
      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('ended', onReset);
      audio.addEventListener('pause', onReset);
      return () => {
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('ended', onReset);
        audio.removeEventListener('pause', onReset);
      };
    }, [audioRef, isPlaying, wordTimestamps]);

    return (
      <div className={cn('flex gap-2.5', isUser ? 'justify-end' : 'justify-start')}>
        {!isUser && (
          <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Bot size={14} />
          </div>
        )}

        <div className={cn(
          'max-w-[76%] rounded-2xl px-4 py-3',
          isUser
            ? 'rounded-br-md bg-slate-900 text-white'
            : 'rounded-bl-md border border-slate-100 bg-slate-50 text-slate-900'
        )}>
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-60">
            {isBusy && <Loader2 size={10} className="animate-spin" />}
            {messageStatusText(message)}
          </div>

          <p className={cn('whitespace-pre-wrap text-sm leading-6', isBusy && !message.text && 'italic opacity-60')}>
            {message.text || (isUser ? 'Listening...' : 'Thinking...')}
          </p>

          {message.error && (
            <p className="mt-2 flex items-center gap-1 text-xs text-red-500">
              <CircleAlert size={12} />{message.error}
            </p>
          )}

          {!isUser && message.audioParts?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {message.audioParts.map((part) => (
                <span key={part.id} className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] capitalize',
                  part.status === 'ready' || part.status === 'played' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : part.status === 'generating' ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : part.status === 'error' ? 'border-red-200 bg-red-50 text-red-600'
                    : 'border-slate-200 bg-white text-slate-400'
                )}>
                  {part.index}: {part.status}
                </span>
              ))}
            </div>
          )}

          {wordTimestamps && wordTimestamps.length > 0 && (
            <div className="mt-2 rounded-xl bg-slate-100/80 px-3 py-2 text-xs leading-6">
              {wordTimestamps.map((item, i) => (
                <React.Fragment key={i}>
                  <span className={i === activeWordIndex ? 'rounded-sm bg-yellow-200 px-0.5' : undefined}>
                    {item.word}
                  </span>
                  {i < wordTimestamps.length - 1 && ' '}
                </React.Fragment>
              ))}
            </div>
          )}

          {hasVoice && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onPlay(message.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  selected
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                )}
              >
                {selected ? <Volume2 size={11} /> : <PlayCircle size={11} />}
                {selected ? 'Playing' : 'Play voice'}
              </button>
              {message.audioUrl && (
                <a
                  href={message.audioUrl}
                  download={`live_reply_${message.id}.wav`}
                  className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 hover:border-slate-300"
                >
                  <Download size={11} />WAV
                </a>
              )}
            </div>
          )}
        </div>

        {isUser && (
          <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
            <UserRound size={14} />
          </div>
        )}
      </div>
    );
  }
  ```

  Now find every place `ChatBubble` is rendered in `LivePage` (search for `<ChatBubble`) and add the `audioRef` prop:

  ```jsx
  <ChatBubble
    key={message.id}
    message={message}
    selected={message.id === liveSpeech.selectedReplyId}
    onPlay={liveSpeech.playReply}
    audioRef={audioRef}
  />
  ```

  (Replace the existing `<ChatBubble ... />` usage — add only `audioRef={audioRef}` since `audioRef` is already defined in `LivePage` at line 190.)

- [ ] **Step 5: Commit**

  ```bash
  git add client/src/services/api.js client/src/hooks/useLiveSpeech.js client/src/pages/LivePage.jsx
  git commit -m "feat: synthesize returns {blob, wordTimestamps}; wire word highlighting into LivePage ChatBubble"
  ```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - `align_words.py` + `wordAligner.js` → Task 1, 2
  - `synthesizeLongTextStreaming` includes `wordTimestamps` in `inference-complete` → Task 3
  - `synthesizeLongText` returns `wordTimestamps` → Task 3
  - `/inference/tts` sets `X-Word-Timestamps` header → Task 4
  - `/inference` sets `X-Word-Timestamps` header → Task 4
  - GPU worker CORS exposes header → Task 4
  - Lambda proxy captures and forwards header → Task 5
  - Lambda CORS exposes header → Task 5
  - `WordTimestampPlayer` component → Task 6
  - `findActiveWordIndex` utility → Task 6
  - `useInferenceSSE` captures `wordTimestamps` + `transcript` → Task 7
  - `InferencePage` uses `WordTimestampPlayer` → Task 7
  - `synthesize` / `synthesizeSentence` return `{blob, wordTimestamps}` → Task 8
  - `useLiveSpeech` patches `wordTimestamps` onto messages → Task 8
  - `ChatBubble` shows highlighted transcript → Task 8
  - Alignment failure silently degrades → covered by `alignWords` returning `null`
  - No new pages, no new CloudFront distributions → confirmed

- [x] **No placeholders:** All code blocks are complete and executable.

- [x] **Type consistency:**
  - `alignWords(wavPath)` → `Promise<Array<{word, start, end}> | null>` — consistent across Tasks 2, 3, 4
  - `synthesize(params)` → `{blob: Blob, wordTimestamps: Array|null}` — updated in Task 8 Step 1, consumed in Task 8 Step 3
  - `inference.wordTimestamps` from `useInferenceSSE` — set in Task 7 Step 1, consumed in Task 7 Step 2
  - `message.wordTimestamps` — patched in `useLiveSpeech` Task 8 Step 3, read in `ChatBubble` Task 8 Step 4
  - `findActiveWordIndex(wordTimestamps, currentTime)` → `number` — called in `WordTimestampPlayer` Task 6, `ChatBubble` Task 8

- [x] **CORS chain is complete:** GPU worker exposes header (Task 4) → Lambda CORS header (Task 5) → browser can read it
