# Live Chatbot Handoff

Last updated: 2026-04-30

This is the short context file to read first when starting new development on the Live chatbot work.

## Current Branch State

- Current working branch during this handoff: `deployment-with-changes`.
- The Live chatbot feature history is also on `chatbot-integrationV1`.
- Latest relevant commit: `90055cb feat: add fast live phrase playback mode`.
- Training and normal Inference paths should stay untouched unless a shared route boundary requires it.
- Current deployed REST Lambda is `Liu_Teng_Yu_Intern2026-Voice_Cloning_Project` in Seoul (`ap-northeast-2`), while the shared S3 bucket remains in Singapore (`ap-southeast-1`).
- Function URL auth target is `AWS_IAM` behind CloudFront Lambda Function URL OAC. The frontend shared Axios client now sends `x-amz-content-sha256` for JSON mutating requests, and Lambda CORS allows that header, which is required for signed POST routes.

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
- While cloned voice is playing, audio input to OpenAI is paused so assistant TTS is not fed back into the next user turn.
- If the user speaks during cloned playback, the browser uses local mic level as a barge-in signal: local cloned playback is interrupted, input resumes, and the speech becomes the next user turn.
- If the user turns the mic off while speaking, the browser sends a short silence tail, then sends `input.commit` through `live-gateway` so OpenAI finishes transcription and generates from that user transcript.
- After mic-off submits a turn, the browser can keep a local barge-in monitor armed during playback without sending audio until the user actually speaks over the reply.
- `Play voice` must replay ready or already-played audio. In Live Fast, replay starts from the first available phrase clip and advances through later ready/played clips.
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

Current deployment fix: CloudFront must route `/api/live/chat/realtime` to the GPU ALB origin before the broader `/api/*` Lambda Function URL behavior. The GPU ALB then path-routes `/api/live/chat/realtime` to `live-gateway:3002`; its default action remains `gpu-worker:3001`.

Do not let SPA fallback rewrite `/api/live/chat/realtime` to `index.html`, and do not route this WebSocket path to the Lambda Function URL.

## Lambda Migration Note

The REST backend can now move to Lambda Function URL behind CloudFront, but the Live chatbot WebSocket should stay stateful. Use the `live-gateway/` process on the GPU EC2 for `/api/live/chat/realtime`, and use `lambda/` for REST routes. Deployment details are in `docs/lambda-serverless-gpu-worker-guide.md`.

Current test networking:

- GPU EC2 has a public ALB for now.
- GPU EC2 is a g6 instance in Seoul and hosts GPT-SoVITS, `gpu-worker`, and `live-gateway`.
- GPU VPC is `VoiClo-Gpu-Seoul-vpc` (`vpc-0b81d044238fcee4d`) in `ap-northeast-2`.
- Public subnets are `VoiClo-Gpu-Seoul-subnet-public1-ap-northeast-2a` and `VoiClo-Gpu-Seoul-subnet-public2-ap-northeast-2b`.
- GPU EC2 is in `VoiClo-Gpu-Seoul-subnet-public1-ap-northeast-2a`.
- ALB is `voice-gpu-alb`, internet-facing, HTTP-only port `80`, DNS `voice-gpu-alb-815777974.ap-northeast-2.elb.amazonaws.com`.
- Frontend S3 bucket is `interns2026-small-projects-bucket-shared`, under prefix `echolect/dist/`.
- CloudFront distribution ID is `E2KTGN0G56FW71`.
- The ALB having two public subnets is normal; ALB nodes span availability zones even if the GPU target is currently one EC2 instance in one subnet.
- ALB default action routes to `gpu-worker:3001`.
- Required ALB path rule: `/api/live/chat/realtime` routes to `live-gateway:3002`.
- Lambda is not VPC-attached yet; Lambda calls the public GPU ALB URL through `GpuWorkerUrl`.
- CloudFront uses the same GPU ALB origin for SSE and WSS behaviors.
- The React SPA is served from an S3 REST origin protected by OAI.
- CloudFront proxies `/api/*` to the Lambda Function URL origin, so the browser does not call the raw Function URL directly.
- The Lambda Function URL origin is `fxeoewfr5wdic5dfxtrlsylonq0bvkdy.lambda-url.ap-northeast-2.on.aws`, HTTPS only, with blank origin path.
- The `/api/*` behavior uses `CachingDisabled` and `AllViewerExceptHostHeader`.
- For `AWS_IAM` Function URL auth with CloudFront OAC, JSON `POST` routes require `x-amz-content-sha256`. `client/src/services/api.js` adds it automatically for JSON `POST`/`PUT`/`PATCH`/`DELETE`.
- The GPU ALB is HTTP-only for the current test setup.
- On the GPU EC2, both services run from the GitHub clone under the `ubuntu` user, with `gpu-worker.service` and `live-gateway.service`.
- The GPU EC2 instance profile already has access to the project S3 bucket/prefix.
- Current security group is shared by ALB and GPU EC2 (`sg-0806b2491f69f242e`). Split this later into separate ALB and instance security groups.
- No frontend, Lambda, CloudFront, or ALB config should depend on the GPU EC2 public IP. Use CloudFront for browser traffic and ALB DNS for Lambda-to-GPU while testing.
- There is no separate security-group inbound rule for SSE. SSE is normal HTTP traffic through CloudFront and the ALB, then the ALB forwards to `gpu-worker:3001`.
- GPU EC2 SG should allow `3001` and `3002` only from the ALB SG, plus SSH `22` from your own IP if needed.
- GPU EC2 SG should not expose `9880`; GPT-SoVITS `api_v2.py` should stay local on `127.0.0.1:9880`.

CloudFront origins:

- S3/frontend origin for the React SPA.
- Lambda Function URL origin for `/api/*` REST requests.
- GPU ALB origin for SSE and the Live WebSocket.

CloudFront behavior order:

1. `/api/live/chat/realtime` -> GPU ALB origin -> ALB routes to `live-gateway:3002`
2. `/train/progress/*` -> GPU ALB origin -> ALB default `gpu-worker:3001`
3. `/inference/progress/*` -> GPU ALB origin -> ALB default `gpu-worker:3001`
4. `/api/*` -> Lambda Function URL origin
5. default `*` -> S3/frontend origin

ALB listener rules:

1. Path `/api/live/chat/realtime` -> live-gateway target group on port `3002`
2. Default action -> gpu-worker target group on port `3001`

Do not add ALB rules for `/train/progress/*`, `/inference/progress/*`, `/models`, or `/training-audio/*`; the default `gpu-worker:3001` target group handles those.

Frontend Lambda deployment uses:

```env
VITE_API_BASE_URL=https://d3dghqhnk7aoku.cloudfront.net
VITE_GPU_WORKER_URL=https://d3dghqhnk7aoku.cloudfront.net
# Optional only if live gateway has a separate origin:
# VITE_LIVE_GATEWAY_URL=https://YOUR_LIVE_GATEWAY_DOMAIN
```

Lambda deploy params can still use the raw public ALB URL for `GpuWorkerUrl`, because Lambda is server-side and is not affected by browser mixed-content rules.

## Live Gateway Env

Live gateway runs on the GPU server beside `gpu-worker` and GPT-SoVITS. It is the process that owns OpenAI Realtime and the browser WebSocket.

Run path:

```bash
cd ~/VoiceCloning/live-gateway
```

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

Live gateway must support these browser control messages:

- `audio.chunk` -> `input_audio_buffer.append`
- `input.pause` -> pause/clear current OpenAI input buffer
- `input.resume` -> allow new input audio chunks
- `input.commit` -> `input_audio_buffer.commit`, then `response.create`

If mic-off gets stuck at transcription in deployment, first confirm that the deployed `live-gateway` code includes `input.commit` support and that `live-gateway.service` has been restarted after `git pull`.

## Lambda Function URL Env

For the current public-ALB test deployment:

```text
S3Bucket=interns2026-small-projects-bucket-shared
S3Region=ap-southeast-1
S3Prefix=echolect/
GpuWorkerUrl=http://voice-gpu-alb-815777974.ap-northeast-2.elb.amazonaws.com
GpuWorkerPublicUrl=https://d3dghqhnk7aoku.cloudfront.net
ModelSource=s3
ArtifactSource=s3
CorsOrigin=https://d3dghqhnk7aoku.cloudfront.net
GpuInstanceId=i-03f258d470a2fa73f
GpuInstanceRegion=ap-northeast-2
GpuIdleStopMinutes=30
```

Keep `S3Region=ap-southeast-1` even though Lambda is in `ap-northeast-2`. The S3 region must match the bucket, not the Lambda function. Using the Lambda region caused this error: `The bucket you are attempting to access must be addressed using the specified endpoint`.

Do not pass `VpcSubnetIds` or `VpcSecurityGroupIds` while Lambda calls the public ALB. Add those only after the GPU worker moves behind private networking.

The Lambda function uses Node.js 20.x with handler `index.handler`. It is packaged with `npm run package:function-url`, uploaded as a normal Lambda zip, and exposed through a Lambda Function URL behind CloudFront. Use Function URL `AWS_IAM` with CloudFront Lambda Function URL OAC for the secure path. If POST routes return a SigV4 signature mismatch, confirm the request includes `x-amz-content-sha256`, the Lambda CORS response allows that header, and the `/api/*` CloudFront behavior uses `AllViewerExceptHostHeader`.

`GpuIdleStopMinutes` only defines the idle threshold. Lambda does not run on a timer by itself; EventBridge must call `/api/instance/idle-check` periodically. Manual `curl -X POST https://d3dghqhnk7aoku.cloudfront.net/api/instance/idle-check` proves the stop path, but automatic shutdown requires the EventBridge rule and target in the deployment guide.

Future production direction: move Lambda to Seoul (`ap-northeast-2`) and keep GPU EC2 private.

- CloudFront -> public ALB -> private GPU EC2 for browser SSE/WSS.
- Lambda in Seoul VPC -> internal ALB -> private GPU EC2 for scalable REST-triggered GPU calls.
- Simpler single-instance alternative: Lambda in Seoul VPC -> GPU EC2 private IP on `3001`.
- Private GPU EC2 -> S3 Gateway VPC Endpoint -> S3.

Prefer Lambda calling the internal ALB for scalability. Direct private IP is acceptable for one fixed GPU EC2 in the same VPC, but `GPU_WORKER_URL` must be updated if the instance is replaced.

CloudFront error pages:

- During backend debugging, keep only `404 -> /index.html -> 200` for React routes.
- Do not use `403 -> /index.html -> 200` while debugging Lambda Function URL/OAC/S3 permissions; it hides real access failures behind the React app.
- For short user-facing demos after backend checks are done, `403 -> /index.html -> 200` can be temporarily restored so direct refreshes on React routes such as `/inference` work with the S3 REST origin.

## Frontend Env

Frontend cloud template: `client/.env.frontend.deployment`

Production frontend env should point REST, SSE, and WSS at CloudFront. CloudFront then routes `/api/*` to the Lambda Function URL origin and GPU streaming/WebSocket paths to the GPU ALB:

```env
VITE_API_BASE_URL=https://d3dghqhnk7aoku.cloudfront.net
VITE_GPU_WORKER_URL=https://d3dghqhnk7aoku.cloudfront.net
# Optional only if live gateway has a separate origin:
# VITE_LIVE_GATEWAY_URL=https://YOUR_LIVE_GATEWAY_DOMAIN
VITE_APP_BASENAME=/
```

Do not add `/api` to either base URL. The app derives:

- `https://.../api/...`
- `ws://.../api/live/chat/realtime` or `wss://.../api/live/chat/realtime`

For local development, these can still point at localhost, but for deployed CloudFront testing they should use the CloudFront domain.

## GPU Worker Env

GPU worker cloud template: `gpu-worker/.env.gpuworker.deployment`

Run path:

```bash
cd ~/VoiceCloning/gpu-worker
npm start
```

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
CORS_ORIGIN=https://d3dghqhnk7aoku.cloudfront.net
```

The GPU worker does not need `OPENAI_API_KEY`. Only `live-gateway` talks to OpenAI Realtime.

GPT-SoVITS runs separately on the same GPU EC2:

```bash
cd /opt/gpt-sovits
. venv/bin/activate
python api_v2.py
```

## S3 Bucket Layout

Bucket: `interns2026-small-projects-bucket-shared`

Prefix: `echolect/`

| S3 path | Purpose |
| --- | --- |
| `echolect/audio/` | General audio storage |
| `echolect/audio/reference/` | Reference voice samples |
| `echolect/audio/output/` | Generated output audio |
| `echolect/models/` | Model storage |
| `echolect/models/user-models/` | User-trained or selected model files |
| `echolect/training/` | Training-related storage |
| `echolect/training/datasets/` | Training datasets |
| `echolect/dist/` | Frontend build files |

## AWS Deploy Profile

Deployment uses a base profile and an assumed-role profile:

```powershell
aws configure --profile account11
aws sts get-caller-identity --profile account11
notepad $env:USERPROFILE\.aws\config
```

Profile config:

```ini
[profile account3]
role_arn = arn:aws:iam::3XXXXXXXXXXX:role/YOUR_ROLE_NAME
source_profile = account11
region = ap-southeast-1
output = json
```

Verify:

```powershell
aws sts get-caller-identity --profile account3
```

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

Lambda Function URL:

- `lambda/inference/index.js`
  - `POST /api/inference`: full-reply WAV generation through long-text inference.
- `lambda/live/index.js`
  - `POST /api/live/tts-sentence`: fast phrase/sentence synthesis.
- `lambda/transcribe/index.js`
  - `POST /api/transcribe`: still used by normal Inference reference-audio transcription. Keep it.
- `lambda/shared/cors.js`
  - Allows `x-amz-content-sha256` so browser preflight succeeds for CloudFront OAC-signed Lambda Function URL POST requests.

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

- `client/src/services/api.js`
  - Shared Axios client for REST calls.
  - Hashes JSON bodies and sends `x-amz-content-sha256` for mutating methods, which CloudFront OAC needs when signing POST requests to a Lambda Function URL using `AWS_IAM`.

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

- Client helper/reference tests: 14 passing when run with `node --test client/src/hooks/liveConversation.test.js client/src/lib/referenceSelection.test.js`.
- Live gateway tests: 5 passing.
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

`POST /api/*` returns Lambda signature mismatch

- This usually means CloudFront OAC signed the Lambda Function URL request but the POST payload hash was missing or mismatched.
- Confirm the browser request includes `x-amz-content-sha256`.
- Confirm Lambda preflight allows `x-amz-content-sha256`.
- Confirm `/api/*` uses `AllViewerExceptHostHeader` so the viewer `Host` header is not forwarded to the Lambda Function URL origin.

Previous audio replays when user speaks again

- This was caused by falling back to the latest ready assistant audio while the new reply was still generating.
- Current fix is `findSelectedPlayback(messages, selectedId)`: no selected valid audio means no playback.
