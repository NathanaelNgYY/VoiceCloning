# Live Inference Feature — Design Spec
**Date:** 2026-04-20

## Overview

A new `/live` page where the user holds a push-to-talk button, speaks, and hears their words played back in the currently-loaded cloned voice. The pipeline is: record → upload → transcribe (server-side whisper) → inference (GPT-SoVITS) → auto-play.

---

## Architecture

### Data Flow

```
[Browser mic]
  → MediaRecorder (WAV blob on button release)
  → POST /api/live/upload         (new — saves blob to TEMP dir, returns filePath)
  → POST /api/transcribe          (existing — returns { text, language })
  → POST /api/inference/generate  (existing — returns { sessionId })
  → GET  /api/inference/progress/:sessionId  (existing SSE)
  → GET  /api/inference/result/:sessionId    (existing WAV blob)
  → new Audio(blobUrl).play()
```

### New Server Endpoint

**`POST /api/live/upload`**
- Accepts: raw audio blob (multipart, field name `audio`, accepts `.wav`/`.webm`/`.ogg`)
- Saves to the existing TEMP ref-audio directory (same as `/api/upload` uses)
- Returns: `{ filePath: "<server path>" }`
- Reuses existing `multer` setup from `server/src/routes/upload.js`

Everything else (transcribe, inference/generate, SSE progress, result fetch) reuses existing routes unchanged.

---

## Page Structure

**Route:** `/live` — added to `App.jsx` router. Nav link added to the existing header nav.

**File:** `client/src/pages/LivePage.jsx`

### Layout (top to bottom)

1. **Hero banner** — same visual style as `InferencePage`. Shows loaded voice name + server ready status from `GET /api/inference/status`, and the active reference audio name. If no model is loaded or no reference is available, renders a warning with a link to `/inference` to configure first.

2. **Push-to-talk button** — large centered button. `mousedown`/`touchstart` starts `MediaRecorder`; `mouseup`/`touchend` stops recording and kicks off the pipeline. Label reflects current state:
   - Idle: "Hold to speak"
   - Recording: "Recording…"
   - Processing: "Processing…" (covers upload + transcribe + inference)
   - Playing: "Playing…"
   After playback ends, state resets to Idle automatically.

3. **Transcript display** — shows the last transcribed text returned by `/api/transcribe`. Persists until the next recording starts.

4. **Audio output** — result WAV auto-plays via `new Audio(url).play()`. A small `<audio controls>` element is also rendered so the user can replay or download.

5. **Error area** — inline dismissible error banner for any step failure (upload / transcribe / inference). Clears when the user starts the next recording.

---

## State Machine

```
idle
  → (mousedown) → recording
recording
  → (mouseup) → processing
processing
  → (audio ready) → playing
  → (any error)  → idle + show error
playing
  → (audio ended) → idle
```

Processing is a single linear async chain: upload → transcribe → generate → SSE complete → fetch result → play. If any step throws, jump to idle with error.

---

## Error Handling

- **No model loaded:** Detected on page mount via `/api/inference/status`. Page renders in a disabled state with a link to `/inference`.
- **No reference audio:** Detected on page mount (see Reference Audio Resolution). Page renders in a disabled state with a link to `/inference`.
- **Microphone denied:** `getUserMedia` rejection is caught; renders an inline error telling the user to allow mic access.
- **Upload / transcribe / inference failure:** Any rejected promise in the chain sets the error message and resets state to idle. The next button press clears the error.
- **Inference server busy (409):** Shown as "Another generation is running, try again shortly."

---

## Components & Files

| File | Change |
|---|---|
| `server/src/routes/upload.js` | Add `POST /live/upload` handler (or new route file) |
| `server/src/index.js` | Mount new live route |
| `client/src/pages/LivePage.jsx` | New page (single file, no sub-components) |
| `client/src/App.jsx` | Add `/live` route + nav link |
| `client/src/services/api.js` | Add `uploadLiveAudio()` helper |

---

## Reference Audio Resolution

The Live page requires `ref_audio_path` and `prompt_text` to call `/api/inference/generate`. These are resolved in order:

1. **`GET /api/inference/current`** — if the server has a completed or in-progress session, its `params` include `ref_audio_path` and `prompt_text`. Use those.
2. **localStorage draft** — fall back to the `voice-cloning-inference-draft` key written by `InferencePage` (contains `refAudioPath`, `promptText`, `promptLang`).
3. **Neither available** — page renders in a disabled state with a prompt: "Run at least one inference on the Inference page first to set a reference audio."

Resolution happens on page mount. The resolved ref audio name is shown in the hero banner.

---

## Constraints & Non-Goals

- No voice model selector on this page — uses whatever is loaded on the server.
- No language selector — uses the server default (`en`). Can be added later.
- No generation settings (top-k, temperature, etc.) — uses inference defaults.
- S3 mode: not in scope for this feature. Live page is local-mode only for now.
- Only one utterance processed at a time (matches existing single-job GPU constraint).
