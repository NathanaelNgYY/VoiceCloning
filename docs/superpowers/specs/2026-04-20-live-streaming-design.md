# Live Page Streaming — Design Spec
**Date:** 2026-04-20  
**Goal:** Minimise time-to-first-audio on the Live page by synthesising per-sentence during speech and streaming chunk playback as fallback.

---

## Problem

The current Live page pipeline is fully sequential:
1. User releases button
2. Full recording uploads
3. Whisper transcribes entire utterance
4. GPT-SoVITS synthesises the whole text
5. Final concatenated WAV downloads
6. Audio plays

No audio is heard until every step completes. For a 3-sentence utterance this is typically 5–10 seconds of silence after release.

---

## Solution: Two parallel tracks

### Track A — Web Speech API (fast path, primary)

While the user **holds the button**, the browser's `SpeechRecognition` API runs in continuous mode alongside `MediaRecorder`. On each `isFinal` speech result the client immediately sends that sentence to the server for synthesis. The first synthesised sentence can play **while the user is still speaking**.

Flow:
1. `start()` → `MediaRecorder.start()` + `SpeechRecognition.start()`
2. `SpeechRecognition.onresult` (isFinal) → push sentence to text queue
3. Text queue drains one POST at a time to `POST /live/tts-sentence`
4. Response WAV blob → push to audio queue
5. Audio queue plays items in order, advancing on `ended`
6. `stop()` → `MediaRecorder.stop()` + `SpeechRecognition.stop()`

### Track B — Whisper + chunk-streaming (fallback / continuation)

After button release, the full recording is always uploaded and transcribed by Whisper. This transcript is shown in the UI.

If Track A produced **no audio** (API unavailable or returned nothing), Track B synthesises the Whisper text via the existing `synthesizeLongTextStreaming` and plays each chunk as `chunk-complete` SSE fires (fetched individually from `GET /inference/chunk/:sessionId/:index`).

If Track A did produce audio, Whisper runs for **display only** — no re-synthesis.

### Audio queue

A single ordered array of object URLs feeds one `<audio>` element. On `ended`, the next URL is loaded and played. Both tracks push into the same queue. Object URLs are revoked after playback.

---

## New server endpoints

### `POST /live/tts-sentence`

Synthesises a single sentence and returns the WAV buffer directly.

**Request body:**
```json
{
  "text": "string",
  "ref_audio_path": "string",
  "prompt_text": "string",
  "prompt_lang": "string",
  "text_lang": "string"
}
```

**Response:** `audio/wav` binary (200) or `{ error }` (4xx/5xx).

Implementation: calls `inferenceServer.synthesize(params)`, streams the buffer back. No SSE, no session. If the inference server is busy, returns 503.

### `GET /inference/chunk/:sessionId/:index`

Serves an individual chunk WAV file from `temp/inference/:sessionId/chunk_NNN.wav`. Used by the fallback path. Files are created by the existing `synthesizeLongTextStreaming` logic — this endpoint just serves them.

Path validation: `sessionId` must be alphanumeric+hyphen only; `index` must be a non-negative integer. Returns 404 if the file doesn't exist yet (client retries on `chunk-complete` SSE).

---

## Client changes

### New hook: `useLiveSpeech`  
**File:** `client/src/hooks/useLiveSpeech.js`

Owns all stateful logic. `LivePage` calls `start()` / `stop()` and reads the exposed state.

**Internal state:**
- `phase`: `idle | recording | synthesising | playing | done`
- `interimTranscript`: live-updating string from Web Speech API
- `finalTranscript`: Whisper transcript after release
- `audioQueue`: array of `{ url, index }`
- `error`: string | null
- `speechApiAvailable`: boolean, detected on first `start()`

**Serialised synthesis:**  
The hook maintains a `pendingTextQueue` (array of strings). A single async loop processes one item at a time — POSTs to `/live/tts-sentence`, awaits the WAV response, pushes to `audioQueue`, then processes the next item. This ensures the inference server is never double-booked.

**Teardown on `stop()`:**
- Cancels pending text queue
- Clears audio queue; revokes all object URLs
- Stops `SpeechRecognition` and `MediaRecorder`

### Updated `LivePage.jsx`

- Replaces manual `MediaRecorder` + `runPipeline` logic with `useLiveSpeech`
- Renders interim transcript (muted colour, live) that upgrades to the Whisper transcript
- Phase label additions: `synthesising…` (Track A running), `done`
- Audio element driven by `audioQueue` — plays next item on `ended`

### `api.js` addition: `synthesizeSentence(params)`

POSTs to `/live/tts-sentence`, returns a WAV `Blob`. Same pattern as the existing `synthesize()` helper.

---

## Error handling

| Scenario | Behaviour |
|---|---|
| Web Speech API unavailable | `speechApiAvailable = false`; after release falls through to Track B entirely |
| Web Speech fires no final results | Detected when Whisper returns and `audioQueue` is empty; triggers Track B |
| `/live/tts-sentence` returns 503 (busy) | Client retries once after 500 ms; if still busy, skips sentence and shows inline error |
| `/live/tts-sentence` fails for one sentence | Skip that sentence, continue queue, show error below transcript |
| User presses again before playback ends | `stop()` tears down everything; new session starts fresh |
| Button released mid-interim-sentence | Interim text discarded; Whisper covers the full utterance |

---

## Files affected

| File | Change |
|---|---|
| `server/src/routes/inference.js` | Add `GET /inference/chunk/:sessionId/:index` |
| `server/src/routes/live.js` (new or existing) | Add `POST /live/tts-sentence` |
| `client/src/hooks/useLiveSpeech.js` | New hook |
| `client/src/pages/LivePage.jsx` | Refactor to use new hook, add interim transcript UI |
| `client/src/services/api.js` | Add `synthesizeSentence()` |
