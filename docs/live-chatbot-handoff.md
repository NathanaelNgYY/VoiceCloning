# Live Chatbot Handoff

Last updated: 2026-04-27

This is the short context file to read first when starting new development on the Live chatbot work.

## Current Branch State

- Current working branch during this handoff: `deployment`.
- The Live chatbot feature history is also on `chatbot-integrationV1`.
- Latest relevant commit: `90055cb feat: add fast live phrase playback mode`.
- Training and normal Inference paths should stay untouched unless a shared route boundary requires it.

## What The Live Feature Does Now

The old Live path no longer uses Live-only Faster Whisper. The browser streams microphone audio to the backend, the backend owns an OpenAI Realtime session, OpenAI returns text, and GPT-SoVITS produces the only audible assistant voice.

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

Fix options:

- Preferred simple fix: set frontend build env to the backend origin, with no `/api` suffix:

```env
VITE_API_BASE_URL=https://your-backend-domain.example.com
```

- Or configure CloudFront so `/api/*` routes to the backend and supports WebSocket upgrade forwarding. Do not let SPA fallback rewrite `/api/live/chat/realtime` to `index.html`.

If frontend and backend are different origins in production, set backend:

```env
CORS_ORIGINS=https://your-frontend-domain.example.com
```

If same-origin, `CORS_ORIGINS` may be left unset.

## Backend Env

Backend cloud template: `server/.env.backend.deployment`

Required for Live chatbot:

```env
OPENAI_API_KEY=your_backend_only_key
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VAD=semantic_vad
OPENAI_REALTIME_SYSTEM_PROMPT=You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English.
```

Cloud backend also uses remote inference/S3:

```env
INFERENCE_MODE=remote
STORAGE_MODE=s3
S3_BUCKET=interns2026-small-projects-bucket-shared
S3_REGION=ap-southeast-1
S3_PREFIX=echolect/
GPU_WORKER_HOST=<GPU_PRIVATE_IP>
GPU_WORKER_PORT=3001
```

## Frontend Env

Frontend cloud template: `client/.env.frontend.deployment`

Set only if frontend is hosted separately from backend or CloudFront cannot forward WebSockets correctly:

```env
VITE_API_BASE_URL=https://your-backend-domain.example.com
```

Do not add `/api`. The app derives both:

- `https://.../api/...`
- `wss://.../api/live/chat/realtime`

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

The GPU worker does not need `OPENAI_API_KEY`. Only the backend server talks to OpenAI Realtime.

## Key Files

Backend:

- `server/src/routes/liveChat.js`
  - Browser-facing WebSocket endpoint: `/api/live/chat/realtime`.
  - Forwards browser audio/control messages to OpenAI bridge.
  - Production origin handling allows same-origin and configured CORS origins.

- `server/src/services/openaiRealtimeBridge.js`
  - Owns backend-to-OpenAI Realtime WebSocket.
  - Uses GA-style auth header only: `Authorization: Bearer ...`.
  - Do not re-add `OpenAI-Beta: realtime=v1`.

- `server/src/services/openaiRealtimeEvents.js`
  - Builds Realtime `session.update`.
  - Uses text output only with `output_modalities: ['text']`.
  - Configures input transcription with `gpt-4o-mini-transcribe`, language `en`.
  - Do not re-add `max_output_tokens` in `session.update`; it caused Realtime parameter issues.

- `server/src/routes/inference.js`
  - `POST /api/inference`: full-reply WAV generation through long-text inference.
  - `POST /api/live/tts-sentence`: fast phrase/sentence synthesis.
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
  - `resolveWsPath()` derives `ws://` or `wss://` from `VITE_API_BASE_URL` or same-origin.

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
npm --prefix server run test:live-chat
npm --prefix client run build
```

Expected current results:

- Client helper tests: 4 passing.
- Server live-chat tests: 24 passing.
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
- Set `VITE_API_BASE_URL` to backend origin or fix CloudFront `/api/*` WebSocket forwarding.

Previous audio replays when user speaks again

- This was caused by falling back to the latest ready assistant audio while the new reply was still generating.
- Current fix is `findSelectedPlayback(messages, selectedId)`: no selected valid audio means no playback.
