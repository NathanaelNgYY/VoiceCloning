# ElevenLabs Voice Cloning App — Design Spec

**Branch:** `elevenlabs-chatbot`
**Date:** 2026-04-30
**Goal:** Replace GPT-SoVITS with ElevenLabs API for voice cloning and TTS, keeping the OpenAI Realtime live chatbot intact. Local development only, no cloud/S3/lambda.

---

## Overview

The existing app (on `main`) uses GPT-SoVITS for voice cloning (8-step training pipeline) and TTS (local FastAPI process). This branch replaces all GPT-SoVITS functionality with ElevenLabs API calls while keeping the live chatbot architecture (OpenAI Realtime WebSocket bridge) completely untouched. The result is a parallel implementation for comparison.

---

## Starting Point

Merge `main` into `elevenlabs-chatbot` before any ElevenLabs work. `main` contains the full live chatbot (OpenAI Realtime bridge, `useLiveSpeech.js`, WebSocket infrastructure). No lambda/S3 code is present on `main`.

---

## Architecture

### What is removed (GPT-SoVITS specific)

**Server services:**
- `server/src/services/inferenceServer.js` — managed local FastAPI process on port 9880
- `server/src/services/pipeline.js` — 8-step training orchestration
- `server/src/services/trainingSteps.js` — individual step definitions
- `server/src/services/configGenerator.js` — generated `s2.json` and `s1longer-v2.yaml`
- `server/src/services/processManager.js` — spawned/killed Python subprocesses
- `server/src/services/longTextInference.js` — text chunking and WAV concatenation

**Server routes:**
- `server/src/routes/training.js` — training pipeline control and SSE
- `server/src/routes/inference.js` — GPT-SoVITS model loading and TTS

### What is added (ElevenLabs)

**Server services:**
- `server/src/services/elevenlabsClient.js` — wrapper around the official `elevenlabs` Node SDK. Reads `ELEVENLABS_API_KEY` from env. Exposes: `listVoices()`, `cloneVoice(name, files)`, `deleteVoice(voiceId)`, `textToSpeech(voiceId, text, modelId)`.

**Server routes:**
- `server/src/routes/voices.js`
  - `GET /api/voices` — list cloned voices from ElevenLabs account
  - `POST /api/voices/clone` — receive multipart audio files via multer, forward to ElevenLabs instant voice cloning, return `{ voiceId, name }`
  - `DELETE /api/voices/:voiceId` — delete voice from ElevenLabs
- `server/src/routes/tts.js`
  - `POST /api/tts` — body: `{ voiceId, text, modelId? }` → calls ElevenLabs TTS → streams MP3 response to client. Default model: `eleven_turbo_v2_5`.

### What stays untouched

- `server/src/routes/liveChat.js` — WebSocket upgrade handler
- `server/src/services/openaiRealtimeBridge.js` — OpenAI Realtime session management
- `server/src/services/openaiRealtimeEvents.js` — event mapping
- `server/src/services/sseManager.js` — SSE client management
- `server/src/routes/upload.js` — multer file upload (reused for voice cloning audio)
- `server/src/index.js` — minor updates only (register new routes, remove old ones)
- `server/src/config.js` — add `ELEVENLABS_API_KEY`, remove GPT-SoVITS env vars

---

## Client Pages

### Tab 1 — Voice Cloning (route: `/`, replaces Training)

Two sections:

**Clone a new voice**
- Reuse `AudioUploader` component for audio file selection
- Text field for voice name
- "Clone Voice" button → `POST /api/voices/clone` → on success show voice name and ID

**Your cloned voices**
- List fetched from `GET /api/voices` on mount
- Each entry shows voice name with a Delete button → `DELETE /api/voices/:voiceId`
- Refreshes list after clone or delete

No SSE streaming, no progress steps. ElevenLabs cloning completes in seconds.

### Tab 2 — Inference (route: `/inference`, simplified)

- Dropdown of cloned voices fetched from `GET /api/voices`
- Text area for synthesis input
- "Generate" button → `POST /api/tts` → plays back returned MP3 via `<audio>` element
- Selecting a voice writes `voiceId` to `localStorage` key `elevenlabs-selected-voice` — this is the signal the Live pages use to know a voice is ready
- No reference audio, no model loading, no SSE

### Tab 3 & 4 — Live Full / Live Fast (routes: `/live`, `/live-fast`)

Minimal changes only:

- `LivePage.jsx` — replace `refParams` / `serverReady` inference check with a `voiceId` read from `localStorage` key `elevenlabs-selected-voice`. Pass `voiceId` into `useLiveSpeech` instead of `refParams`. "Not ready" warning: "No voice selected — go to Inference and select a voice first."
- `useLiveSpeech.js` — replace `refParams` prop with `voiceId`. Remove calls to `buildLiveReplyParams()` / `buildLiveSentenceParams()` (GPT-SoVITS specific); pass `{ voiceId, text }` directly to `synthesize()` / `synthesizeSentence()`. All conversation state logic, phase management, and interrupt handling remain untouched.
- `client/src/hooks/liveConversation.js` — remove `buildLiveReplyParams` and `buildLiveSentenceParams` helpers (no longer needed). All other helpers (`splitLiveReplyPhrases`, `updateMessage`, etc.) stay.
- `client/src/services/api.js` — `synthesize()` and `synthesizeSentence()` rewired to call `POST /api/tts` with the passed `voiceId`; response is MP3 instead of WAV (the `<audio>` element handles both).

### App.jsx

- Rename "Training" nav link to "Voice Cloning"
- Update footer tagline from "Built with GPT-SoVITS" to "Built with ElevenLabs"
- Remove `GpuInstanceControl` component (EC2 instance start/stop button)

---

## Data Flow

### Voice cloning
```
User uploads audio files + name
  → POST /api/voices/clone (multipart)
  → server: elevenlabsClient.cloneVoice(name, files)
  → ElevenLabs API creates voice
  → returns { voiceId, name }
  → displayed in "Your cloned voices" list
```

### TTS (Inference page)
```
User selects voice → voiceId saved to localStorage
User types text → POST /api/tts { voiceId, text }
  → server: elevenlabsClient.textToSpeech(voiceId, text, modelId)
  → ElevenLabs returns MP3 stream
  → client plays audio
```

### Live chatbot synthesis
```
User speaks → OpenAI Realtime (STT + LLM) → assistant text
  → useLiveSpeech calls synthesize({ voiceId, text })
  → POST /api/tts { voiceId, text }
  → ElevenLabs MP3 → played back in <audio> element
```

---

## Environment Variables

Add to `server/.env`:
```
ELEVENLABS_API_KEY=your_key_here
```

`OPENAI_API_KEY` remains required for the live chatbot LLM via OpenAI Realtime.

`GPT_SOVITS_ROOT`, `PYTHON_EXEC`, and all other GPT-SoVITS-specific env vars are removed.

---

## Dependencies

**Server — add:**
- `elevenlabs` (official ElevenLabs Node SDK)

**Server — remove:**
- No Python dependency (GPT-SoVITS is gone)
- S3/lambda packages if present on the branch

**Client — no new dependencies.** MP3 playback works natively in all modern browsers.

---

## What is explicitly out of scope

- S3, lambda, GPU worker — local only
- ElevenLabs Conversational AI — OpenAI Realtime handles STT + LLM
- Multi-tenancy or authentication
- ElevenLabs model selector UI (defaults to `eleven_turbo_v2_5`)
- Professional voice cloning (instant cloning only)
