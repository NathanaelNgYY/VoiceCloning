# External Chatbot -> VoiceCloning Handoff

Last updated: 2026-05-22

## Source Of Truth

- Use branch `separate-containers` as the latest structure.
- Note: the branch is spelled `separate-containers` in git, even if earlier notes said `seperate-containers`.
- This handoff is a VoiceCloning-side integration note. Do not treat the ClinicalChatbot session handoff as the source for this document.

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

## Voice-Profile Status

The VoiceCloning side now persists full saved profiles in S3:

- `voice-profiles/<voiceProfileId>.json`
- `voice-profiles/active.json`

Current API support in this repo:

- `POST /api/voice-profile/activate`
- `GET /api/voice-profile/active`
- `GET /api/voice-profile/internal/:voiceProfileId`

The internal full-profile endpoint is protected by a shared header configured on this Lambda:

- `VOICE_PROFILE_INTERNAL_AUTH_HEADER_NAME`
- `VOICE_PROFILE_INTERNAL_AUTH_HEADER_VALUE`

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

### Important correction: website save is now server-side, but `active.json` is still global

Right now, selecting a voice on the website already loads the GPT and SoVITS weights into the shared inference worker:

- [LivePage.jsx](C:/Users/User/Downloads/VoiceCloningProjectV1/VoiceCloning/client/src/pages/LivePage.jsx:266)
- [InferencePage.jsx](C:/Users/User/Downloads/VoiceCloningProjectV1/VoiceCloning/client/src/pages/InferencePage.jsx:881)

Those flows call:

```text
POST /api/models/select
```

and the inference worker stores the currently loaded pair globally in:

- [inferenceServer.js](C:/Users/User/Downloads/VoiceCloningProjectV1/VoiceCloning/gpu-inference-worker/src/services/inferenceServer.js:88)

The website can now also save the full cloning profile server-side through:

- `POST /api/voice-profile/activate`

That saved profile includes:

- `voiceProfileId`
- `displayName`
- `gptKey` or `gptPath`
- `sovitsKey` or `sovitsPath`
- `ref_audio_path`
- `prompt_text`
- `prompt_lang`
- `text_lang`
- `preferredRoute`
- `aux_ref_audio_paths`
- default tuning values

But `voice-profiles/active.json` is still only a global active pointer. That is useful for the website UI, but it is **not** the right runtime source of truth for long-term per-chatbot or per-assignment routing.

At the same time, the website-driven save flow is now more reliable than before. When a user switches voices on the website and the correct training clips for that selected voice finish loading, the frontend can now auto-pick the best primary reference and up to five auxiliary clips for that voice and sync the active saved profile back to the backend. This reduces the risk that the active saved profile is still using an older reference set from a previous voice switch.

## Recommended Long-Term Compatibility Model

For correct long-term behavior, keep two separate responsibilities:

1. ClinicalChatbot owns the stable binding:
   - `assignmentId + scenarioId -> voiceProfileId`
   - or `chatbotId -> voiceProfileId`
2. VoiceCloning owns the full lookup:
   - `voiceProfileId -> full cloned-voice profile`

That means the clinical chatbot runtime should not depend on whichever voice another operator most recently activated on the website.

Recommended runtime flow:

1. ClinicalChatbot resolves the local binding to `voiceProfileId`.
2. ClinicalChatbot can use either of these two paths:
   - simple: call `POST /api/live/tts-sentence` or `POST /api/inference` with `voiceProfileId + text`
   - explicit: call `GET /api/voice-profile/internal/:voiceProfileId`, then `POST /api/models/select`, then synthesize with the full voice fields
3. VoiceCloning returns WAV audio to its own frontend.

## Recommended Endpoint Shape For This Requirement

Your proposed chatbot-backend endpoints are fine, but they need one clarification:

### `GET /assignment/:assignmentId/voice-profile?scenarioId=...`

This should return summary data for the `voiceProfileId` already bound to that assignment or scenario.

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

`voiceProfileId` should stay a stable backend-owned identifier, not a browser-owned set of raw cloning fields.

## Internal Lookup Contract

The full-profile lookup endpoint on this repo is:

```text
GET /api/voice-profile/internal/:voiceProfileId
```

It is routed through the existing Lambda `/api/*` behavior and returns the full saved JSON for that `voiceProfileId`.

Protect it with:

- `VOICE_PROFILE_INTERNAL_AUTH_HEADER_NAME`
- `VOICE_PROFILE_INTERNAL_AUTH_HEADER_VALUE`

ClinicalChatbot can call it through CloudFront at:

```text
https://doovx82fh9tfs.cloudfront.net/api/voice-profile/internal/{voiceProfileId}
```

### Do not use `live-gateway` unless needed

`live-gateway` is only needed if the other chatbot wants to reuse this repo's browser-to-backend realtime mic streaming path at:

```text
/api/live/chat/realtime
```

If the other chatbot already has its own chat backend or its own LLM pipeline, then it should usually **not** use `live-gateway`. It should only call the REST TTS endpoints.

## REST Endpoints To Reuse

### Simpler contract now supported

The VoiceCloning backend can now resolve a saved voice profile internally when the chatbot sends only:

```json
{
  "voiceProfileId": "lecturer-a-v1",
  "text": "Hello, this is the cloned voice response."
}
```

If `voiceProfileId` is present, the backend will:

1. load the full saved profile from server-side storage
2. load the correct GPT + SoVITS pair if needed
3. apply `ref_audio_path`, `prompt_text`, `prompt_lang`, `aux_ref_audio_paths`, and saved defaults automatically
4. return cloned audio

This works on:

- `POST /api/live/tts-sentence`
- `POST /api/inference`
- `POST /api/inference/generate`

### 1. `POST /api/live/tts-sentence`

Use this for short reply chunks or sentence-by-sentence playback.

Implemented through:

- `lambda/router.js`
- `lambda/live/index.js`
- `gpu-inference-worker/src/routes/inference.js` via `/inference/tts`

Required JSON fields:

```json
{
  "voiceProfileId": "lecturer-a-v1",
  "text": "Hello, this is the cloned voice response."
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
- This route is still one-shot. It does not split a long reply into multiple sentence requests by itself.
- If the external chatbot wants progressive sentence-by-sentence playback, it should split the text and queue repeated `POST /api/live/tts-sentence` requests on its own.
- For Chinese cloned speech, the current frontend sends `text_lang: "all_zh"` instead of `"zh"`.
- If you do not want the backend to resolve the saved profile automatically, you can still send the full explicit voice fields yourself.

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
- The same `voiceProfileId + text` shortcut is supported here.

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

1. Simplest recommended path:
   - send `voiceProfileId + text` to `POST /api/live/tts-sentence` or `POST /api/inference`
   - if you want Live Fast-style progressive playback, split the assistant text into sentences or short phrases and queue `POST /api/live/tts-sentence` calls one by one while managing playback order on the chatbot side
2. Optional explicit path:
   - read the saved profile from server-side storage
   - call `POST /api/models/select` if needed
   - send the full voice fields explicitly
3. Return the WAV audio back to the chatbot frontend.

## Browser-Side Verification On The VoiceCloning Website

The VoiceCloning frontend now writes structured browser-console logs that can help verify whether the correct reference set is being saved after a voice switch.

Useful console labels include:

- `live voice switched`
- `live auto-selected references`
- `activate request`
- `activate response`
- `activate error`

These logs make it easier to confirm whether the current save really includes the intended primary reference path, the auxiliary references, and the tuning defaults before the external chatbot tries to use that `voiceProfileId`.

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
