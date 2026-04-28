# Live Chatbot Handoff

Last updated: 2026-04-28

This is the short context file to read first when starting new development on the Live chatbot work.

## Current Branch State

- Current working branch during this handoff: `deployment`.
- The Live chatbot feature history is also on `chatbot-integrationV1`.
- Latest relevant commit: `90055cb feat: add fast live phrase playback mode`.
- Training and normal Inference paths should stay untouched unless a shared route boundary requires it.

## What The Live Feature Does Now

The old Live path no longer uses Live-only Faster Whisper. The browser streams microphone audio to `live-gateway`, `live-gateway` owns an OpenAI Realtime session, OpenAI returns text, and GPT-SoVITS produces the only audible assistant voice.

There are now two Live modes:

- `/live` / `Live Full`
  - Chatbot layout.
  - User speaks.
  - OpenAI Realtime listens with VAD, keeps session memory, transcribes user speech for display, and generates English assistant text.
  - The full assistant text is sent once to `POST /api/inference`.
  - Existing long-text inference handles punctuation/chunk splitting internally and returns one complete WAV.

- `/live-fast` / `Live Fast`
  - Same chatbot layout.
  - User speaks.
  - OpenAI Realtime generates English assistant text.
  - Frontend splits assistant text by punctuation.
  - Each phrase is sent to `POST /api/live/tts-sentence`.
  - Phrase audio is generated and played in order. The next phrase only starts after the previous phrase audio ends.

## Important UX Rules

- Assistant replies must be English-only for now.
- Only cloned GPT-SoVITS audio is played. OpenAI audio output is not requested and not played.
- While cloned voice is playing, mic input to OpenAI is paused.
- If the user speaks/taps during cloned playback, local cloned playback is interrupted and input resumes.
- The frontend should not send `response.cancel` just because cloned playback was interrupted. That caused:

```text
AI conversation failed: Cancellation failed: no active response found
```

OpenAI had already finished its text response, so there was no OpenAI response to cancel.

## Cloud Deployment Gotcha

If the frontend logs this:

```text
WebSocket connection to 'wss://<cloudfront-domain>/api/live/chat/realtime' failed
```

and a WebSocket probe gets:

```text
Unexpected server response: 200
```

then CloudFront is returning the React `index.html` instead of forwarding the WebSocket upgrade to the backend.

Current deployment fix: CloudFront must route `/api/live/chat/realtime` to the GPU ALB origin before the broader `/api/*` API Gateway behavior. The GPU ALB then path-routes `/api/live/chat/realtime` to `live-gateway:3002`; its default action remains `gpu-worker:3001`.

Do not let SPA fallback rewrite `/api/live/chat/realtime` to `index.html`, and do not route this WebSocket path to API Gateway.

## Lambda Migration Note

The REST backend can now move to Lambda/API Gateway, but the Live chatbot WebSocket should stay stateful. Use the `live-gateway/` process on the GPU EC2 for `/api/live/chat/realtime`, and use `lambda/` for REST routes. Deployment details are in `docs/lambda-serverless-gpu-worker-guide.md`.

Current test networking:

- GPU EC2 has a public ALB for now.
- ALB default action routes to `gpu-worker:3001`.
- ALB path rule `/api/live/chat/realtime` routes to `live-gateway:3002`.
- Lambda is not VPC-attached yet; Lambda calls the public GPU ALB URL through `GpuWorkerUrl`.
- CloudFront uses the same GPU ALB origin for SSE and WSS behaviors.

Frontend Lambda deployment uses:

```env
VITE_API_BASE_URL=https://your-api-gateway-domain.example.com
VITE_GPU_WORKER_URL=https://d3dghqhnk7aoku.cloudfront.net
# Omit VITE_LIVE_GATEWAY_URL when the same GPU ALB path-routes /api/live/chat/realtime to live-gateway.
```

Lambda deploy params can still use the raw public ALB URL for `GpuWorkerUrl`, because Lambda is server-side and is not affected by browser mixed-content rules.

## Live Gateway Env

Live gateway runs on the GPU server beside `gpu-worker` and GPT-SoVITS. It is the process that owns OpenAI Realtime and the browser WebSocket.

Required for Live chatbot:

```env
OPENAI_API_KEY=your_backend_only_key
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VAD=semantic_vad
OPENAI_REALTIME_SYSTEM_PROMPT=You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English.
PORT=3002
CORS_ORIGIN=https://d3dghqhnk7aoku.cloudfront.net
```

`gpu-worker` does not need `OPENAI_API_KEY`; OpenAI Realtime belongs to `live-gateway`.

## Lambda Env / Deploy Params

For the current public-ALB test deployment:

```text
S3Bucket=interns2026-small-projects-bucket-shared
S3Region=ap-southeast-1
S3Prefix=echolect/
GpuWorkerUrl=http://voice-gpu-alb-815777974.ap-northeast-2.elb.amazonaws.com
GpuWorkerPublicUrl=http://voice-gpu-alb-815777974.ap-northeast-2.elb.amazonaws.com
ModelSource=gpu-worker
ArtifactSource=s3
CorsOrigin=https://d3dghqhnk7aoku.cloudfront.net
```

Do not pass `VpcSubnetIds` or `VpcSecurityGroupIds` while Lambda calls the public ALB. Add those only after the GPU worker moves behind private networking.

## Frontend Env

Frontend cloud template: `client/.env.frontend.deployment`

Production frontend env should point REST at API Gateway and SSE/WSS at the GPU ALB:

```env
VITE_API_BASE_URL=https://your-api-gateway-domain.example.com
VITE_GPU_WORKER_URL=https://d3dghqhnk7aoku.cloudfront.net
VITE_APP_BASENAME=/
```

Do not add `/api` to either base URL. The app derives:

- `https://.../api/...`
- `ws://.../api/live/chat/realtime` or `wss://.../api/live/chat/realtime`

## GPU Worker Env

GPU worker cloud template: `gpu-worker/.env.gpuworker.deployment`

Current values:

```env
WORKER_HOST=0.0.0.0
WORKER_PORT=3001
GPT_SOVITS_ROOT=/opt/gpt-sovits
PYTHON_EXEC=/opt/gpt-sovits/venv/bin/python
INFERENCE_HOST=127.0.0.1
INFERENCE_PORT=9880
S3_BUCKET=interns2026-small-projects-bucket-shared
S3_REGION=ap-southeast-1
S3_PREFIX=echolect/
```

The GPU worker does not need `OPENAI_API_KEY`. Only `live-gateway` talks to OpenAI Realtime.

## Key Files

Live gateway:

- `live-gateway/src/routes/liveChat.js`
  - Browser-facing WebSocket endpoint: `/api/live/chat/realtime`.
  - Forwards browser audio/control messages to OpenAI bridge.
  - Production origin handling allows same-origin and configured CORS origins.

- `live-gateway/src/services/openaiRealtimeBridge.js`
  - Owns backend-to-OpenAI Realtime WebSocket.
  - Uses GA-style auth header only: `Authorization: Bearer ...`.
  - Do not re-add `OpenAI-Beta: realtime=v1`.

- `live-gateway/src/services/openaiRealtimeEvents.js`
  - Builds Realtime `session.update`.
  - Uses text output only with `output_modalities: ['text']`.
  - Configures input transcription with `gpt-4o-mini-transcribe`, language `en`.
  - Do not re-add `max_output_tokens` in `session.update`; it caused Realtime parameter issues.

Lambda/API Gateway:

- `lambda/inference/index.js`
  - `POST /api/inference`: full-reply WAV generation through long-text inference.
- `lambda/live/index.js`
  - `POST /api/live/tts-sentence`: fast phrase/sentence synthesis.
- `lambda/transcribe/index.js`
  - `POST /api/transcribe`: still used by normal Inference reference-audio transcription. Keep it.

Frontend:

- `client/src/App.jsx`
  - Adds nav/routes:
    - `/live` as `Live Full`
    - `/live-fast` as `Live Fast`

- `client/src/pages/LivePage.jsx`
  - Shared chatbot UI for both modes.
  - Receives `replyMode="full"` or `replyMode="phrases"`.

- `client/src/hooks/useLiveSpeech.js`
  - Streams mic PCM to backend.
  - Handles chat messages, user transcription display, OpenAI assistant text, cloned audio generation, playback, and interruption.
  - Full mode calls `synthesize()` -> `/api/inference`.
  - Fast mode calls `synthesizeSentence()` -> `/api/live/tts-sentence`.

- `client/src/hooks/liveConversation.js`
  - Pure helpers for English params, punctuation phrase splitting, chat message updates, and selected playback lookup.
  - `findSelectedPlayback()` intentionally does not fall back to old audio. This prevents previous WAV replay when a new reply is still generating.

- `client/src/services/liveChatSocket.js`
  - Browser WebSocket wrapper.

- `client/src/lib/runtimeConfig.js`
  - `resolveWsPath()` derives `ws://` or `wss://` from `VITE_LIVE_GATEWAY_URL`, then `VITE_GPU_WORKER_URL`, then `VITE_API_BASE_URL`/same-origin.
  - In the one-ALB setup, omit `VITE_LIVE_GATEWAY_URL` so WebSocket uses `VITE_GPU_WORKER_URL`.

## Removed Live-Only Faster Whisper Path

These Live-only pieces were removed:

- `server/src/services/liveTranscriber.js`
- `server/src/python/faster_whisper_worker.py`
- `gpu-worker/src/services/liveTranscriber.js`
- `gpu-worker/src/python/faster_whisper_worker.py`
- Live upload/transcribe routes such as `/live/upload` and `/live/transcribe-phrase`

Do not restore them for the chatbot Live path. Normal `/api/transcribe` remains for the Inference page.

## Verification Commands

Use these before saying the Live work is good:

```powershell
node --test client/src/hooks/liveConversation.test.js
npm --prefix live-gateway test
npm --prefix client run build
```

Expected current results:

- Client helper tests: 4 passing.
- Live gateway route tests pass.
- Client production build passes.

Useful grep checks:

```powershell
Get-ChildItem -Recurse -Path client/src -Include *.js,*.jsx |
  Select-String -Pattern 'response.cancel'
```

Frontend should not contain `response.cancel` for cloned playback interruption.

```powershell
Get-ChildItem -Recurse -Path client/src,server/src,gpu-worker/src -Include *.js,*.jsx |
  Select-String -Pattern 'liveTranscriber|faster_whisper_worker|transcribeLivePhrase|uploadLiveAudio'
```

Code paths should not reference the removed Live-only Faster Whisper flow.

## Common Failure Meanings

`Cancellation failed: no active response found`

- Frontend sent `response.cancel` to OpenAI after OpenAI had already finished text generation.
- Current intended behavior is local playback interruption only.

`WebSocket failed` with CloudFront URL

- CloudFront likely returned `index.html` instead of forwarding the WebSocket upgrade.
- Ensure CloudFront behavior `/api/live/chat/realtime` points to the GPU ALB origin and has higher priority than `/api/*`.
- Ensure the GPU ALB listener rule `/api/live/chat/realtime` points to the `live-gateway:3002` target group.

Previous audio replays when user speaks again

- This was caused by falling back to the latest ready assistant audio while the new reply was still generating.
- Current fix is `findSelectedPlayback(messages, selectedId)`: no selected valid audio means no playback.
