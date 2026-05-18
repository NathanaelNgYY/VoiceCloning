# External Chatbot -> VoiceCloning Handoff

Last updated: 2026-05-18

## Source Of Truth

- Use branch `separate-containers` as the latest structure.
- Note: the branch is spelled `separate-containers` in git, even if earlier notes said `seperate-containers`.

## Goal

Keep the current VoiceCloning system and website as they are.

Do **not** move the training site or existing voice-cloning frontend into the other chatbot project.

The new integration goal is:

1. The other deployed chatbot keeps its own chatbot flow.
2. That chatbot calls this VoiceCloning system when it needs cloned voice output.
3. This system returns cloned audio back to the chatbot flow.

In short: treat this repo as a **voice-cloning service**, not as something that must be merged into the chatbot app.

## New Requirement: follow the website-selected voice

The latest requirement is stricter than a normal static `voiceProfileId` lookup:

```text
Whatever model is selected on this VoiceCloning website should be the voice the
other clinical chatbot uses for cloned replies.
```

That means the source of truth is no longer just "assignment defaults".

The source of truth becomes:

1. the voice selected in this website
2. the reference-audio setup currently paired with that voice
3. the active inference tuning defaults used for cloned output

## Current Architecture On `separate-containers`

There are now four main runtime pieces:

| Service | Folder | Responsibility |
| --- | --- | --- |
| `voice-gpu-worker` | `gpu-worker/` | Training, transcription, training audio browsing, worker activity |
| `voice-gpu-inference-worker` | `gpu-inference-worker/` | Model loading, GPT-SoVITS inference, inference artifacts |
| `voice-lambda-api` | `lambda/` | Public REST API layer that routes to training or inference workers |
| `voice-live-gateway` | `live-gateway/` | WebSocket + OpenAI Realtime bridge for the existing Live chatbot UI |

The frontend remains static and separate. This is intentional.

## Recommended Integration Path

### Recommended path: chatbot owns conversation, VoiceCloning owns TTS

This is the cleanest approach for the other project:

1. The other chatbot handles user auth, chat UI, session memory, LLM reply generation, and deployment.
2. Once the chatbot has reply text, its backend calls this VoiceCloning backend.
3. VoiceCloning returns WAV audio for the selected cloned voice.
4. The chatbot returns that audio to its own frontend or stores it for playback.

This is better than trying to embed the whole current Live page into the other system.

### Voice-profile source: choose option 3

For the external chatbot integration, the recommended choice is:

```text
3. From a backend endpoint in the chatbot stack
```

Example:

```text
GET /assignment/:id/voice-profile
```

Recommended behavior:

1. The chatbot assignment or scenario can carry a simple stable identifier such as `voiceProfileId`.
2. The chatbot backend resolves that identifier to the full voice-cloning profile.
3. The chatbot backend then calls the VoiceCloning REST API with the resolved values.

This is better than the other options because:

- it keeps `gptKey`, `sovitsKey`, `ref_audio_path`, and similar fields out of browser state
- it avoids fragile `localStorage`, query-param, or route-state handoff
- it keeps voice-profile ownership inside the chatbot backend
- it makes future profile changes possible without changing frontend payload contracts
- it fits the current recommendation that the chatbot backend should own a `voiceCloningClient`

Avoid option 2 for this integration.

Option 1 is acceptable only as an internal server-side contract, but it is not the best public/session contract if it exposes raw voice-cloning fields to the browser or to assignment payloads directly.

### Important correction: current website selection is only partially server-side

Right now, selecting a voice on the website already loads the GPT and SoVITS weights into the shared inference worker:

- [LivePage.jsx](C:/Users/User/Downloads/VoiceCloningProjectV1/VoiceCloning/client/src/pages/LivePage.jsx:266)
- [InferencePage.jsx](C:/Users/User/Downloads/VoiceCloningProjectV1/VoiceCloning/client/src/pages/InferencePage.jsx:881)

Those flows call:

```text
POST /api/models/select
```

and the inference worker stores the currently loaded pair globally in:

- [inferenceServer.js](C:/Users/User/Downloads/VoiceCloningProjectV1/VoiceCloning/gpu-inference-worker/src/services/inferenceServer.js:88)

But the other important voice-cloning fields are **not** persisted server-side yet:

- `ref_audio_path`
- `prompt_text`
- `prompt_lang`
- `aux_ref_audio_paths`
- live/default inference tuning values

Those still live in browser state in the website UI.

So if the clinical chatbot simply reuses "whatever model is currently loaded", it will still be missing the full reference profile unless we persist that profile somewhere server-side.

## Recommended Shared-State Fix

If you want the clinical chatbot to always follow the website-selected voice, then add a shared active-profile record.

Recommended behavior:

1. When the user clicks `Save voice` or otherwise confirms the selected voice in this website, persist the active voice profile server-side.
2. The clinical chatbot backend reads that same active profile.
3. The chatbot then uses that resolved profile when generating cloned replies.

The persisted active profile should include:

- `voiceProfileId`
- `gptKey`
- `sovitsKey`
- `ref_audio_path`
- `prompt_text`
- `prompt_lang`
- `aux_ref_audio_paths`
- default tuning values
- optional metadata such as `displayName`, `selectedAt`, `selectedBy`

The browser should still receive only summary data when needed. The full profile stays server-side.

## Recommended Endpoint Shape For This Requirement

Your proposed chatbot-backend endpoints are fine, but they need one clarification:

### `GET /assignment/:assignmentId/voice-profile?scenarioId=...`

This should return summary data for the **currently active website-selected voice**, not an unrelated static assignment voice.

Example response:

```json
{
  "voiceProfileId": "lecturer-a",
  "displayName": "Lecturer A"
}
```

### `POST /assignment/:assignmentId/voice-response`

This should:

1. verify access
2. resolve `voiceProfileId` to the full server-side voice profile
3. call `POST /api/models/select` only if the loaded pair is wrong
4. call `POST /api/live/tts-sentence` for short replies or `POST /api/inference` for long replies
5. return `audio/wav`

If the website-selected voice is the true source of truth, then `voiceProfileId` here is mainly a guard or summary identifier, not a frontend-controlled free choice.

## Best Place To Persist The Active Voice

There are two workable choices:

### Option A: chatbot backend owns the active-profile record

This fits your proposed endpoints best.

Flow:

1. The VoiceCloning website calls a chatbot-backend endpoint when voice selection is confirmed.
2. The chatbot backend stores the full active profile server-side.
3. `GET /assignment/:assignmentId/voice-profile` returns summary from that stored active profile.
4. `POST /assignment/:assignmentId/voice-response` uses the stored full profile.

### Option B: VoiceCloning backend owns the active-profile record

This is often cleaner operationally, because the website already lives here and already knows the selected reference setup.

Flow:

1. The VoiceCloning website persists the active full profile into this stack.
2. The clinical chatbot backend fetches summary or full server-side data from this stack.
3. The chatbot backend still owns access control and response generation.

Either option works. The critical part is not where the record lives. The critical part is that the record must exist server-side, because the current website UI state is not enough by itself.

### Do not use `live-gateway` unless needed

`live-gateway` is only needed if the other chatbot wants to reuse this repo's browser-to-backend realtime mic streaming path at:

```text
/api/live/chat/realtime
```

If the other chatbot already has its own chat backend or its own LLM pipeline, then it should usually **not** use `live-gateway`. It should only call the REST TTS endpoints.

## REST Endpoints To Reuse

### 1. `POST /api/live/tts-sentence`

Use this for short reply chunks or sentence-by-sentence playback.

Implemented through:

- `lambda/router.js`
- `lambda/live/index.js`
- `gpu-inference-worker/src/routes/inference.js` via `/inference/tts`

Required JSON fields:

```json
{
  "text": "Hello, this is the cloned voice response.",
  "ref_audio_path": "training/datasets/example/ref.wav"
}
```

Common optional fields:

```json
{
  "text_lang": "en",
  "prompt_text": "Reference transcript here",
  "prompt_lang": "en",
  "aux_ref_audio_paths": [
    "training/datasets/example/aux1.wav",
    "training/datasets/example/aux2.wav"
  ],
  "top_k": 5,
  "top_p": 0.85,
  "temperature": 0.7,
  "repetition_penalty": 1.35,
  "speed_factor": 1.0
}
```

Notes:

- Returns binary `audio/wav`.
- Best for low-latency chatbot replies.
- Current Lambda layer forces sentence-style synthesis settings for this route in `lambda/live/index.js`.
- For Chinese cloned speech, the current frontend sends `text_lang: "all_zh"` instead of `"zh"`.

### 2. `POST /api/inference`

Use this for longer full replies when you want the server to do long-text chunking internally.

Implemented through:

- `lambda/inference/index.js`
- `gpu-inference-worker/src/routes/inference.js`

This uses the same core voice parameters, but it is better suited for longer text because the inference worker handles chunking and retry logic.

Notes:

- Returns binary `audio/wav`.
- Better for paragraph-length answers.
- Slower than `POST /api/live/tts-sentence`, but less client work.

### 3. `GET /api/models`

Use this to list available GPT and SoVITS weights.

Implemented through:

- `lambda/models/index.js`
- `gpu-inference-worker/src/routes/models.js`

### 4. `POST /api/models/select`

Use this to load the correct GPT and SoVITS weights before TTS.

Example payload:

```json
{
  "gptKey": "models/user-models/gpt/example.ckpt",
  "sovitsKey": "models/user-models/sovits/example.pth"
}
```

Or in local/non-S3 style:

```json
{
  "gptPath": "/absolute/or/worker/path/example.ckpt",
  "sovitsPath": "/absolute/or/worker/path/example.pth"
}
```

## Practical Integration Sequence

For the other chatbot backend, the simplest flow is:

1. Read the currently active website-selected voice profile from server-side storage.
2. If needed, call `POST /api/models/select` to load the matching GPT + SoVITS weights.
3. Build TTS params with:
   - `ref_audio_path`
   - `prompt_text`
   - `prompt_lang`
   - optional `aux_ref_audio_paths`
   - optional inference tuning values
4. If the reply is short, call `POST /api/live/tts-sentence`.
5. If the reply is long, call `POST /api/inference`.
6. Return the WAV audio back to the chatbot frontend.

## Recommended Voice Profile Shape

The other chatbot should keep a per-voice mapping like this on its backend:

```json
{
  "voiceId": "lecturer-a",
  "gptKey": "models/user-models/gpt/lecturer-a.ckpt",
  "sovitsKey": "models/user-models/sovits/lecturer-a.pth",
  "ref_audio_path": "training/datasets/lecturer-a/reference.wav",
  "prompt_text": "Example transcript for the reference clip",
  "prompt_lang": "en",
  "aux_ref_audio_paths": [
    "training/datasets/lecturer-a/aux1.wav",
    "training/datasets/lecturer-a/aux2.wav"
  ],
  "defaults": {
    "speed_factor": 1.0,
    "top_k": 5,
    "top_p": 0.85,
    "temperature": 0.7,
    "repetition_penalty": 1.35
  }
}
```

This is better than trying to derive everything dynamically from the website every time.

Recommended assignment/session contract:

```json
{
  "assignmentId": "case-123",
  "voiceProfileId": "lecturer-a"
}
```

Then the chatbot backend resolves `voiceProfileId` to the full backend-owned voice profile before calling this repo's API.

For the website-driven sync requirement, that resolution should point to the currently active saved website selection, not an unrelated hardcoded assignment default.

## Important Constraint: model loading is global right now

The biggest backend limitation is that the inference worker keeps one active loaded model pair at a time.

Relevant file:

- `gpu-inference-worker/src/services/inferenceServer.js`

It tracks:

- `currentGPTWeights`
- `currentSoVITSWeights`

So today, `POST /api/models/select` changes the shared loaded model for the worker.

That means:

- this is fine for one main chatbot voice
- this is risky for many different voices at the same time
- frequent model switching will hurt latency and can affect concurrent users

If the external chatbot only needs one main lecturer/brand voice, the current system is much easier to reuse.

## Important Constraint: not truly multi-user ready

Read:

- `docs/multi-user-readiness.md`

Current reality:

- training is single-job
- inference is shared-state
- there is no queueing layer
- there is no strong user isolation
- horizontal scale is not ready yet

For a small demo or controlled deployment, the current setup is workable.

For many concurrent users with many different voices, extra architecture work is still needed.

## Current Request-Signing Gotcha

The deployed REST path currently goes through CloudFront to a Lambda Function URL protected by OAC / `AWS_IAM`.

Because of that, JSON mutating requests currently need:

```text
x-amz-content-sha256
```

The existing frontend already handles this in:

- `client/src/services/api.js`

If the other chatbot backend calls the same CloudFront `/api/*` endpoints directly, it must reproduce that hashing behavior for JSON `POST` / `PUT` / `PATCH` / `DELETE` calls.

Minimal Node example:

```js
import crypto from 'node:crypto';

async function postJsonWithHash(url, body) {
  const raw = JSON.stringify(body);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-amz-content-sha256': hash,
    },
    body: raw,
  });
}
```

This matters for:

- `POST /api/models/select`
- `POST /api/live/tts-sentence`
- `POST /api/inference`

## Best First Implementation For The Other Chat Session

The next chat should probably implement this in the chatbot project:

1. Add a small `voiceCloningClient` service on the chatbot backend.
2. Add server-side storage for the currently active website-selected voice profile.
3. Update the VoiceCloning website flow so confirming a voice also persists the full active profile server-side.
4. Add a backend-owned lookup path, for example `GET /assignment/:id/voice-profile`, that returns summary data from that active profile.
5. Add SHA-256 request hashing for JSON POST requests.
6. Add `ensureVoiceLoaded(voiceProfile)` that calls `POST /api/models/select` only when needed.
7. Add `synthesizeReply(text, voiceProfile)`:
   - use `/api/live/tts-sentence` for short replies
   - use `/api/inference` for long replies
8. Return the WAV bytes or store the audio and return a URL to the chatbot frontend.

## If We Need Full Realtime Browser Mic Later

Only if the other chatbot later wants to reuse the full browser mic streaming flow from this repo, then look at:

- `live-gateway/src/routes/liveChat.js`
- `live-gateway/src/services/openaiRealtimeBridge.js`
- `client/src/lib/runtimeConfig.js`
- `docs/ai-handoff.md`

That path is for:

- browser mic audio
- WebSocket session handling
- OpenAI Realtime bridging
- half-duplex mic/pause/resume behavior

It is not necessary for the simpler backend-to-backend TTS bridge.

## Most Relevant Files For The Next Chat

- `docs/containerization-images-split.md`
- `docs/ai-handoff.md`
- `docs/multi-user-readiness.md`
- `lambda/router.js`
- `lambda/live/index.js`
- `lambda/inference/index.js`
- `lambda/models/index.js`
- `lambda/shared/gpuWorker.js`
- `gpu-inference-worker/src/routes/inference.js`
- `gpu-inference-worker/src/routes/models.js`
- `gpu-inference-worker/src/services/inferenceServer.js`
- `client/src/services/api.js`
- `client/src/lib/liveFastSetup.js`

## Short Summary For The Next Chat

Do not migrate the current voice-cloning website into the chatbot project.

Instead:

- keep this repo deployed as the voice-cloning backend
- persist the active website-selected voice profile server-side
- let the other chatbot backend call this repo's REST API
- load the right voice with `POST /api/models/select` when needed
- synthesize short replies with `POST /api/live/tts-sentence`
- synthesize long replies with `POST /api/inference`

That is the safest way to make the clinical chatbot follow the exact voice selected on this website under the current `separate-containers` structure.
