# Cloud Frontend Flow README

This README explains how the deployed/cloud version of the Voice Cloning app is wired together. It is written for code review, especially to show how the React frontend talks to CloudFront, Lambda, the GPU EC2 worker, S3, and the live chat gateway.

This document does not describe local mock mode.

## 1. High-Level Cloud Architecture

In the cloud version, the browser only needs to know the CloudFront domain.

```text
Browser / React frontend
  |
  v
CloudFront
  |-- React static files -> S3 frontend build
  |-- /api/* REST calls -> Lambda Function URL
  |-- /train/progress/* SSE -> GPU ALB -> gpu-worker:3001
  |-- /inference/progress/* SSE -> GPU ALB -> gpu-worker:3001
  |-- /api/live/chat/realtime WebSocket -> GPU ALB -> live-gateway:3002

Lambda
  |-- talks to S3 for uploads, model lists, and presigned URLs
  |-- talks to GPU ALB for training, inference, model loading, and transcription
  |-- talks to EC2 API for GPU instance start/status

GPU EC2
  |-- gpu-worker:3001 runs GPT-SoVITS training/inference orchestration
  |-- live-gateway:3002 owns the OpenAI Realtime WebSocket bridge
  |-- GPT-SoVITS Python service runs locally on the EC2 instance
```

The browser should not call the raw Lambda Function URL or the raw HTTP GPU ALB directly. In deployment, it calls CloudFront, and CloudFront chooses the correct backend by path.

## 2. Frontend Cloud Environment

The important frontend environment variables are read in `client/src/lib/runtimeConfig.js`.

For cloud mode, they should point to CloudFront:

```env
VITE_API_BASE_URL=https://d3dghqhnk7aoku.cloudfront.net
VITE_GPU_WORKER_URL=https://d3dghqhnk7aoku.cloudfront.net
# Optional only if live-gateway has a separate public origin:
# VITE_LIVE_GATEWAY_URL=https://YOUR_LIVE_GATEWAY_DOMAIN
VITE_APP_BASENAME=/
```

What those values do:

| Variable | Used by | Meaning in cloud mode |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `resolveApiPath()` and Axios | Base origin for REST API calls. The code adds `/api` automatically. |
| `VITE_GPU_WORKER_URL` | `resolveWorkerPath()` | Base origin for browser streaming routes such as training and inference SSE. |
| `VITE_LIVE_GATEWAY_URL` | `resolveWsPath()` | Optional separate origin for the live WebSocket. Usually left unset so it uses `VITE_GPU_WORKER_URL`. |
| `VITE_APP_BASENAME` | React Router | Router base path. Usually `/`. |

Important detail: `client/src/services/api.js` creates one shared Axios client with:

```js
baseURL: API_BASE_URL
```

`API_BASE_URL` resolves to:

```text
https://d3dghqhnk7aoku.cloudfront.net/api
```

So this frontend call:

```js
api.post('/train', params)
```

becomes this browser request:

```text
POST https://d3dghqhnk7aoku.cloudfront.net/api/train
```

## 3. CloudFront Path Responsibilities

CloudFront is the public entry point. It routes requests by path:

| Browser path | CloudFront target | Why |
| --- | --- | --- |
| `/` and frontend assets | S3 frontend build | Serves the React app. |
| `/api/live/chat/realtime` | GPU ALB -> `live-gateway:3002` | WebSocket path for live chatbot audio/text conversation. |
| `/train/progress/*` | GPU ALB -> `gpu-worker:3001` | Server-Sent Events for live training logs/progress. |
| `/inference/progress/*` | GPU ALB -> `gpu-worker:3001` | Server-Sent Events for long inference progress. |
| `/api/*` | Lambda Function URL | Normal REST API requests. |

Order matters. `/api/live/chat/realtime` must be matched before the broader `/api/*` behavior. Otherwise CloudFront may send the WebSocket to Lambda or return the React `index.html`, which breaks the WebSocket upgrade.

## 4. Important Frontend Files

| File | Responsibility |
| --- | --- |
| `client/src/main.jsx` | Starts React and wraps the app in `BrowserRouter`. |
| `client/src/App.jsx` | Defines the main pages and the top-right GPU instance button. |
| `client/src/lib/runtimeConfig.js` | Converts frontend env vars into REST, SSE, and WebSocket URLs. |
| `client/src/services/api.js` | Main REST API client used by the pages. |
| `client/src/services/sse.js` | Opens `EventSource` connections for training and inference progress. |
| `client/src/services/liveChatSocket.js` | Opens the live chatbot WebSocket. |
| `client/src/pages/TrainingPage.jsx` | Uploads training audio and starts/stops training. |
| `client/src/pages/InferencePage.jsx` | Loads models, manages reference audio, transcribes reference clips, and generates speech. |
| `client/src/pages/LivePage.jsx` | Runs the live voice chatbot UI. |
| `client/src/hooks/useLiveSpeech.js` | Handles microphone capture, live WebSocket messages, cloned voice playback, and barge-in behavior. |

## 5. Lambda Entry Point and Routing

The cloud REST backend starts at:

```text
lambda/index.js -> lambda/router.js
```

`lambda/index.js` exports `handler = dispatch`. `lambda/router.js` checks the HTTP method and path, then forwards the event to the correct route module.

Main Lambda routes:

| Cloud path | Lambda module | Purpose |
| --- | --- | --- |
| `GET /api/config` | `lambda/config/index.js` | Tells the frontend this is S3/remote mode. |
| `POST /api/upload/presign` | `lambda/upload/index.js` | Creates S3 presigned PUT URLs for training audio. |
| `POST /api/upload/confirm` | `lambda/upload/index.js` | Confirms uploaded training files exist in S3. |
| `POST /api/upload-ref/presign` | `lambda/upload/index.js` | Creates S3 presigned PUT URL for reference audio. |
| `POST /api/upload-ref/confirm` | `lambda/upload/index.js` | Confirms uploaded reference audio exists in S3. |
| `POST /api/train` | `lambda/training/index.js` | Validates config, then tells GPU worker to start training. |
| `POST /api/train/stop` | `lambda/training/index.js` | Tells GPU worker to stop a training session. |
| `GET /api/train/current` | `lambda/training/index.js` | Reads current training state from GPU worker. |
| `GET /api/models` | `lambda/models/index.js` | Lists model checkpoints from S3 or GPU worker, depending on env. |
| `POST /api/models/select` | `lambda/models/index.js` | Loads GPT and SoVITS weights on the GPU worker. |
| `POST /api/transcribe` | `lambda/transcribe/index.js` | Sends reference audio path to GPU worker for transcription. |
| `GET /api/inference/status` | `lambda/inference/index.js` | Checks whether GPT-SoVITS inference is ready. |
| `POST /api/inference` | `lambda/inference/index.js` | Synchronous text-to-speech request that returns a WAV. |
| `POST /api/inference/generate` | `lambda/inference/index.js` | Starts long text generation and returns a session ID. |
| `GET /api/inference/result/:sessionId` | `lambda/inference/index.js` | Returns a URL for the final generated WAV. |
| `POST /api/inference/cancel` | `lambda/inference/index.js` | Cancels active long-text generation. |
| `GET /api/inference/current` | `lambda/inference/index.js` | Reads current inference state from GPU worker. |
| `POST /api/live/tts-sentence` | `lambda/live/index.js` | Generates one short cloned-voice phrase for Live Fast mode. |
| `GET /api/training-audio/:expName` | `lambda/training-audio/index.js` | Lists processed training clips for an experiment. |
| `GET /api/training-audio/file/:expName/:filename` | `lambda/training-audio/index.js` | Returns a URL for a processed training clip. |
| `GET /api/ref-audio?filePath=...` | `lambda/training-audio/index.js` | Returns a URL for uploaded/reference audio. |
| `GET /api/instance/status` | `lambda/instance/index.js` | Checks EC2 state and worker health. |
| `POST /api/instance/start` | `lambda/instance/index.js` | Starts the GPU EC2 instance. |
| `GET/POST /api/instance/idle-check` | `lambda/instance/index.js` | Stops the GPU instance if it has been idle long enough. |

Lambda uses `lambda/shared/gpuWorker.js` when it needs to call the GPU worker. That helper reads:

```text
GPU_WORKER_URL
GPU_WORKER_PUBLIC_URL
```

`GPU_WORKER_URL` is server-side and can be the raw ALB URL because Lambda is not limited by browser mixed-content rules. `GPU_WORKER_PUBLIC_URL` is used when Lambda needs to return a browser-safe public URL.

## 6. GPU Worker Routes

The GPU worker is an Express service on the GPU EC2 instance. In cloud mode it is reached through the GPU ALB.

Entry point:

```text
gpu-worker/src/index.js
```

Main route files:

| GPU worker path | File | Purpose |
| --- | --- | --- |
| `GET /healthz` | `gpu-worker/src/index.js` | Health check used by Lambda and ALB. |
| `POST /train` | `gpu-worker/src/routes/training.js` | Starts the training pipeline and returns a session ID. |
| `GET /train/progress/:sessionId` | `gpu-worker/src/routes/training.js` | SSE stream for training logs and step progress. |
| `POST /train/stop` | `gpu-worker/src/routes/training.js` | Kills the running training process for a session. |
| `GET /train/current` | `gpu-worker/src/routes/training.js` | Returns remembered training state. |
| `GET /models` | `gpu-worker/src/routes/models.js` | Lists local GPT/SoVITS checkpoint files on the GPU machine. |
| `POST /models/download` | `gpu-worker/src/routes/models.js` | Downloads an S3 model file into the GPU worker cache. |
| `POST /ref-audio/download` | `gpu-worker/src/routes/models.js` | Downloads reference audio from S3 into the GPU worker cache. |
| `GET /inference/status` | `gpu-worker/src/routes/inference.js` | Checks GPT-SoVITS readiness and loaded weights. |
| `POST /inference/weights/gpt` | `gpu-worker/src/routes/inference.js` | Loads GPT weights. |
| `POST /inference/weights/sovits` | `gpu-worker/src/routes/inference.js` | Loads SoVITS weights. |
| `POST /inference` | `gpu-worker/src/routes/inference.js` | Runs long text TTS and returns one WAV. |
| `POST /inference/generate` | `gpu-worker/src/routes/inference.js` | Starts streaming long-text generation. |
| `GET /inference/progress/:sessionId` | `gpu-worker/src/routes/inference.js` | SSE stream for inference chunk progress. |
| `GET /inference/result/:sessionId` | `gpu-worker/src/routes/artifacts.js` | Serves final generated WAV from GPU worker storage. |
| `POST /inference/cancel` | `gpu-worker/src/routes/inference.js` | Cancels a generation session. |
| `GET /inference/current` | `gpu-worker/src/routes/inference.js` | Returns current generation state. |
| `POST /inference/tts` | `gpu-worker/src/routes/inference.js` | Short single TTS call used by Live Fast. |
| `POST /transcribe` | `gpu-worker/src/routes/transcribe.js` | Downloads audio from S3 and runs transcription. |
| `GET /training-audio/:expName` | `gpu-worker/src/routes/artifacts.js` | Lists processed clips on the GPU machine. |
| `GET /training-audio/file/:expName/:filename` | `gpu-worker/src/routes/artifacts.js` | Serves a processed training clip. |
| `GET /ref-audio` | `gpu-worker/src/routes/artifacts.js` | Serves reference audio from allowed local paths. |
| `GET /activity/status` | `gpu-worker/src/routes/activity.js` | Reports whether the worker is busy or idle. |

## 7. Live Gateway Routes

The live gateway is a separate Express + WebSocket service on the GPU EC2 instance.

Entry point:

```text
live-gateway/src/index.js
```

Main WebSocket route:

```text
/api/live/chat/realtime
```

Code:

```text
live-gateway/src/routes/liveChat.js
live-gateway/src/services/openaiRealtimeBridge.js
```

What it does:

1. Browser opens `wss://<cloudfront-domain>/api/live/chat/realtime`.
2. CloudFront routes that path to the GPU ALB.
3. ALB routes that path to `live-gateway:3002`.
4. `live-gateway` opens a backend WebSocket to OpenAI Realtime.
5. Browser sends microphone audio chunks.
6. OpenAI Realtime returns transcribed user text and assistant text.
7. Browser receives text events and then asks Lambda/GPU worker to generate cloned GPT-SoVITS audio.

Browser messages sent to `live-gateway` include:

| Browser message | live-gateway action |
| --- | --- |
| `audio.chunk` | Sends base64 microphone audio to OpenAI Realtime. |
| `input.pause` | Pauses/clears OpenAI input while cloned voice is playing. |
| `input.resume` | Allows microphone audio again. |
| `input.commit` | Commits buffered audio and asks OpenAI to respond. |
| `response.cancel` | Cancels an active OpenAI response if needed. |

## 8. Main User Flows

### A. App Load

1. Browser loads the React app from CloudFront/S3.
2. `client/src/App.jsx` renders the pages and GPU instance button.
3. `GpuInstanceControl` calls:

```text
GET /api/instance/status
```

4. Lambda checks the EC2 instance state and calls the GPU worker `/healthz` endpoint if the instance is running.
5. If the user clicks Start GPU, the frontend calls:

```text
POST /api/instance/start
```

6. Lambda starts the configured EC2 instance through the AWS EC2 SDK.

### B. Training Audio Upload

Code path:

```text
TrainingPage.jsx -> uploadFiles() in services/api.js
```

Flow:

1. Frontend calls:

```text
POST /api/upload/presign
```

2. Lambda validates the experiment name and filenames.
3. Lambda returns S3 presigned PUT URLs.
4. Browser uploads the actual audio files directly to S3 with `fetch(presignedUrl, { method: 'PUT' })`.
5. Browser calls:

```text
POST /api/upload/confirm
```

6. Lambda checks S3 to confirm the files exist.

This keeps large audio upload traffic out of Lambda.

### C. Training Start and Progress

Code path:

```text
TrainingPage.jsx -> startTraining()
TrainingPage.jsx -> useSSE()
useSSE.js -> connectSSE()
sse.js -> EventSource(resolveWorkerPath('/train/progress/:sessionId'))
```

Flow:

1. Frontend calls:

```text
POST /api/train
```

2. Lambda validates the request and calls the GPU worker:

```text
POST /train
```

3. GPU worker creates a training session and starts the GPT-SoVITS training pipeline.
4. Frontend opens the progress stream:

```text
GET /train/progress/:sessionId
```

5. CloudFront sends that SSE request to the GPU ALB and then to `gpu-worker:3001`.
6. GPU worker sends events such as logs, step start, step complete, complete, or error.

Training stop:

```text
POST /api/train/stop
```

Lambda forwards that to:

```text
POST /train/stop
```

### D. Model Selection and Loading

Code path:

```text
InferencePage.jsx -> getModels()
InferencePage.jsx -> selectModels()
```

Flow:

1. Frontend loads available models:

```text
GET /api/models
```

2. Lambda either lists S3 model files or asks the GPU worker for local model files, depending on backend env.
3. User selects a GPT checkpoint and a SoVITS checkpoint.
4. Frontend calls:

```text
POST /api/models/select
```

5. Lambda makes sure the files are available to the GPU worker.
6. Lambda tells the GPU worker to load weights:

```text
POST /inference/weights/sovits
POST /inference/weights/gpt
```

7. GPU worker talks to the local GPT-SoVITS inference service.

### E. Reference Audio and Transcription

Reference upload:

```text
InferencePage.jsx -> uploadRefAudio()
POST /api/upload-ref/presign
Browser PUT to S3
POST /api/upload-ref/confirm
```

Reference transcription:

```text
InferencePage.jsx -> transcribeAudio()
POST /api/transcribe
```

Lambda forwards transcription to the GPU worker:

```text
POST /transcribe
```

The GPU worker downloads the S3 audio file locally, runs the transcription script, and returns transcript text/language.

### F. Long Text Inference

Code path:

```text
InferencePage.jsx -> startGeneration()
InferencePage.jsx -> useInferenceSSE()
useInferenceSSE.js -> connectInferenceSSE()
sse.js -> EventSource(resolveWorkerPath('/inference/progress/:sessionId'))
```

Flow:

1. Frontend calls:

```text
POST /api/inference/generate
```

2. Lambda forwards to GPU worker:

```text
POST /inference/generate
```

3. GPU worker creates a session and starts long-text synthesis.
4. Frontend opens:

```text
GET /inference/progress/:sessionId
```

5. CloudFront routes this SSE stream directly to GPU ALB -> `gpu-worker:3001`.
6. GPU worker sends chunk progress events.
7. When generation completes, frontend calls:

```text
GET /api/inference/result/:sessionId
```

8. Lambda returns a browser-fetchable URL for the final WAV.
9. Frontend fetches that URL and plays the audio.

Cancel generation:

```text
POST /api/inference/cancel
```

Lambda forwards to:

```text
POST /inference/cancel
```

### G. Live Full Mode

Route:

```text
/live
```

Code path:

```text
LivePage.jsx -> useLiveSpeech({ replyMode: 'full' })
useLiveSpeech.js -> createLiveChatSocket()
liveChatSocket.js -> WebSocket('/api/live/chat/realtime')
```

Flow:

1. Browser opens a WebSocket:

```text
wss://d3dghqhnk7aoku.cloudfront.net/api/live/chat/realtime
```

2. CloudFront routes it to GPU ALB -> `live-gateway:3002`.
3. `live-gateway` opens a backend OpenAI Realtime session.
4. Browser streams microphone chunks to `live-gateway`.
5. OpenAI Realtime returns user transcript and assistant text.
6. In Live Full mode, the full assistant text is sent through the normal inference endpoint:

```text
POST /api/inference
```

7. Lambda forwards to GPU worker:

```text
POST /inference
```

8. GPU worker returns one complete WAV.
9. Browser plays the cloned voice audio.

### H. Live Fast Mode

Route:

```text
/live-fast
```

Live Fast uses the same WebSocket path for OpenAI Realtime text, but it generates cloned audio phrase by phrase.

Flow after OpenAI returns assistant text:

1. Frontend splits the assistant text by punctuation.
2. For each phrase, frontend calls:

```text
POST /api/live/tts-sentence
```

3. Lambda forwards to GPU worker:

```text
POST /inference/tts
```

4. GPU worker returns a short WAV for that phrase.
5. Browser plays phrase audio in order.

This mode feels faster because the first phrase can play before the whole reply is synthesized.

## 9. Why Some Browser Calls Bypass Lambda

Most frontend calls go through `/api/*` and Lambda. Two types intentionally do not:

| Type | Browser path | Reason |
| --- | --- | --- |
| Training SSE | `/train/progress/:sessionId` | Needs a long-lived HTTP stream from GPU worker. |
| Inference SSE | `/inference/progress/:sessionId` | Needs a long-lived HTTP stream from GPU worker. |
| Live WebSocket | `/api/live/chat/realtime` | Needs a stateful WebSocket server, so it goes to `live-gateway`, not Lambda. |

Lambda is best for short request/response REST work. SSE and WebSocket connections are long-lived and stateful, so the browser reaches the GPU-side services through CloudFront and the ALB.

## 10. CORS and Signed POST Detail

Because the frontend calls CloudFront from the browser, backend responses must allow the frontend origin through CORS.

Lambda CORS headers are in:

```text
lambda/shared/cors.js
```

GPU worker CORS is in:

```text
gpu-worker/src/index.js
```

Live gateway CORS/origin checks are in:

```text
live-gateway/src/index.js
live-gateway/src/routes/liveChat.js
```

For Lambda Function URL with `AWS_IAM` behind CloudFront OAC, JSON mutating requests need an `x-amz-content-sha256` header. The frontend adds it automatically in:

```text
client/src/services/api.js
```

That is why JSON `POST` calls like `/api/train`, `/api/models/select`, and `/api/inference/generate` work through the signed CloudFront -> Lambda Function URL path.

## 11. Quick Code Review Guide

If you want to review how the frontend interacts with the rest of the cloud system, start in this order:

1. `client/src/lib/runtimeConfig.js`
   - Shows how CloudFront URLs are built.
2. `client/src/services/api.js`
   - Shows every REST API call the frontend makes.
3. `client/src/services/sse.js`
   - Shows training/inference progress streams.
4. `client/src/services/liveChatSocket.js`
   - Shows the live WebSocket URL.
5. `client/src/pages/TrainingPage.jsx`
   - Shows the training user flow.
6. `client/src/pages/InferencePage.jsx`
   - Shows model loading, reference audio, transcription, and generation.
7. `client/src/pages/LivePage.jsx` and `client/src/hooks/useLiveSpeech.js`
   - Shows live chatbot behavior.
8. `lambda/router.js`
   - Shows which `/api/*` routes Lambda supports.
9. `lambda/*/index.js`
   - Shows what each Lambda route does.
10. `gpu-worker/src/routes/*.js`
   - Shows what runs on the GPU EC2 worker.
11. `live-gateway/src/routes/liveChat.js`
   - Shows the live WebSocket bridge.

## 12. One-Sentence Summary

The React frontend talks to CloudFront; CloudFront routes normal REST calls to Lambda, long-lived progress streams and live WebSocket traffic to the GPU ALB, Lambda uses S3 plus the GPU worker for heavy work, and the GPU EC2 runs GPT-SoVITS plus the live OpenAI Realtime gateway.
