# API Notes

## Lambda REST Surface (`/api/*`)

Primary router: `lambda/router.js`

### Config and uploads

- `GET /api/config`
- `POST /api/upload/presign`
- `POST /api/upload/confirm`
- `POST /api/upload-ref/presign`
- `POST /api/upload-ref/confirm`

### Lesson analytics

- `POST /api/analytics/events`
  - Accepts schema version 1 with 1-50 allowlisted lesson events and requires a verified
    Entra token in dev. Immutable gzip NDJSON batches remain in hourly S3 partitions.
  - Maintains a 30-day per-concept support window. Two rewinds contribute at most `1`
    total; two clarification requests contribute at most `2` total. The internal support
    score caps at `3` and qualifying count at four. Long pauses and transcript scrolling
    remain raw analytics only and do not affect support state. Duplicate IDs are idempotent.
- `GET /api/learner/me?lesson=<slug>`
  - Recalculates and returns only the authenticated user's current rolling summary.
- `GET /api/supervisor/users`
- `GET /api/supervisor/users/<oid>`
  - Require the configured Entra supervisor app role; return profile and summary data.
- `DELETE /api/supervisor/users/<oid>/lessons/<slug>/concepts/<conceptId>`
  - Supervisor-only destructive reset for one learner concept; rebuilds or removes its
    lesson summary.

### Training library

- `GET /api/training-library`
- `POST /api/training-library/presign`
- `POST /api/training-library/confirm`
- `POST /api/training-library/snapshot`
- `DELETE /api/training-library/:id`
- `POST /api/training-library/:id/replace-presign`
- `POST /api/training-library/:id/replace-confirm`

### Training

- `POST /api/train`
- `POST /api/train/stop`
- `GET /api/train/current`

Notes:

- `POST /api/train` requires `expName`.
- Optional training config currently includes `batchSize`, `sovitsEpochs`, `gptEpochs`, `sovitsSaveEvery`, `gptSaveEvery`, `asrLanguage`, `asrModel`, and `skipDenoise`.
- Training SSE currently reports 9 steps and now includes `Extract Speaker Verification` between HuBERT and semantic extraction.

### Models and voice profile

- `GET /api/models`
- `POST /api/models/select`
- `POST /api/voice-profile/activate`
- `GET /api/voice-profile/active`

### Inference and live TTS

- `POST /api/inference`
- `POST /api/inference/generate`
  - Optional Live Full chunk overrides: `max_chunk_words` (10–100; omission keeps the 170-character default) and `max_sentences_per_chunk` (1–5; default 2).
- `GET /api/inference/result/:sessionId`
- `GET /api/inference/chunk/:sessionId/:index` — raw generated chunk used by progressive queue playback
- `GET /api/inference/chunk-preview/:sessionId/:index` — shared-loudness-normalized chunk preview matching the final Full WAV
- `POST /api/inference/regenerate-chunk` — regenerate one saved Full chunk by `sessionId` and `index`, then rebuild previews and the final WAV
- `POST /api/inference/insert-chunk` — synthesize text through the Full quality pipeline, insert it before `index` (`0..chunkCount`), reindex later chunks, then rebuild previews and the final WAV
- `POST /api/inference/delete-chunk` — delete one saved Full chunk by `sessionId` and `index`, reindex the remaining chunks, then rebuild previews and the final WAV; the only remaining chunk cannot be deleted
- `POST /api/inference/cancel`
- `GET /api/inference/current`
- `GET /api/inference/status`
- `POST /api/live/tts-sentence`
  - A request with reference audio plus complete `voice_model.gptRef` and
    `voice_model.sovitsRef` uses that immutable snapshot without rereading the saved
    profile. A request that provides only `voiceProfileId`, or lacks a complete
    snapshot, still resolves the saved profile normally.
  - Staging timing response headers: `X-VCS-Profile-Resolve-Ms`,
    `X-VCS-Worker-Round-Trip-Ms`, `X-VCS-Lambda-Total-Ms`,
    `X-VCS-Capacity-Retry-Count`, and `X-VCS-Capacity-Retry-Sleep-Ms`.
  - `X-VCS-GPU-Queue-Wait-Ms` is optional; it was not observed through the current
    public Target Optimizer path, so consumers must preserve a missing value as null.

### Audio browsing and transcription

- `POST /api/transcribe`
- `GET /api/training-audio/:expName`
- `GET /api/training-audio/file/:expName/:filename`
- `GET /api/ref-audio`

### GPU instance control

- `GET /api/instance/status`
- `POST /api/instance/start`
- `GET /api/instance/idle-check`
- `POST /api/instance/idle-check`

## Streaming / Socket Paths

- Training SSE: `/train/progress/:sessionId`
- Inference SSE: `/inference/progress/:sessionId`
- Live WebSocket: `/api/live/chat/realtime`

## Main Source Files

- Frontend caller: `client/src/services/api.js`
- Live socket client: `client/src/services/liveChatSocket.js`
- REST router: `lambda/router.js`
- Training worker routes: `gpu-worker/src/routes/`
- Inference worker routes: `gpu-inference-worker/src/routes/`
- Live gateway route: `live-gateway/src/routes/liveChat.js`
