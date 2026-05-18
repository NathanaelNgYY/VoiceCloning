# TTS Word Timestamps — Design Spec

**Date:** 2026-05-18  
**Status:** Approved for implementation planning

---

## Summary

Add word-level timestamp alignment to TTS output so the frontend can highlight the current spoken word in real time as audio plays. The feature appears on the existing **InferencePage** (batch TTS) and **LivePage** (live chat), with no new pages and no changes to the two-CloudFront architecture.

Inspired by ElevenLabs (`/v1/text-to-speech/{id}/with-timestamps`) and Azure Speech SDK (`WordBoundary` events), both of which return per-word timing data alongside audio. Since this app uses GPT-SoVITS (which does not expose timing metadata), we recover timestamps post-synthesis using faster-whisper, which is already installed on the GPU worker.

---

## Goals

- Show a word-highlighted transcript **above** the audio player on both pages
- The word currently being spoken is highlighted in real time as audio plays
- Alignment is non-blocking: if it fails, the audio still works, the transcript just has no highlighting
- No new pages, no new CloudFront distributions, no changes to training pipeline

---

## Non-Goals

- Replacing GPT-SoVITS with ElevenLabs or Azure for synthesis
- Subtitle/SRT export
- Character-level timestamps
- Changing the two-CloudFront deployment architecture

---

## Reference: How ElevenLabs and Azure Do It

**ElevenLabs** `/with-timestamps` endpoint returns character-level alignment alongside base64 audio:
```json
{
  "audio_base64": "...",
  "alignment": {
    "characters": ["H","e","l","l","o"],
    "character_start_times_seconds": [0.0, 0.05, 0.1, 0.15, 0.2],
    "character_end_times_seconds": [0.05, 0.1, 0.15, 0.2, 0.25]
  }
}
```
Characters are grouped into words by the client.

**Azure Speech SDK** fires `WordBoundary` events during synthesis:
```json
{ "type": "WordBoundary", "audioOffset": 1500000, "text": "Hello", "wordLength": 5 }
```
`audioOffset` is in 100-nanosecond ticks, converted to seconds by dividing by 10,000,000.

Both expose timing because their synthesis models were trained to emit it. GPT-SoVITS does not expose this, so we use faster-whisper to recover it post-synthesis.

---

## Word Timestamp Format (internal)

```json
[
  { "word": "Hello", "start": 0.12, "end": 0.45 },
  { "word": "world", "start": 0.48, "end": 0.82 }
]
```

All times in seconds, relative to the start of the audio clip. `null` means alignment was not attempted or failed.

---

## Architecture

### Data Flow — InferencePage (batch TTS)

```
User clicks Generate
  → POST /inference/generate → sessionId
  → SSE /inference/progress/:sessionId
      chunk-start / chunk-complete events (existing)
      → synthesis completes → final.wav written
      → wordAligner runs faster-whisper on final.wav
      → inference-complete SSE event includes wordTimestamps[]
  → Frontend stores wordTimestamps
  → WordTimestampPlayer renders transcript above audio player
  → audio timeupdate → active word highlighted
```

### Data Flow — LivePage (per-phrase TTS)

```
AI text phrase ready
  → POST /inference/tts (via synthesize / synthesizeSentence)
      → GPU Worker synthesizes phrase WAV
      → wordAligner runs faster-whisper on phrase WAV
      → Response: WAV body + X-Word-Timestamps header (JSON)
  → useLiveSpeech reads X-Word-Timestamps header
  → ChatBubble stores wordTimestamps per message
  → As phrase audio plays → current word highlighted in that bubble
```

---

## Backend Changes (gpu-inference-worker)

### New: `scripts/align_words.py`

A standalone Python script. Takes a WAV file path as `sys.argv[1]`, optional model size as `sys.argv[2]` (defaults to `"tiny"`).

- Loads `WhisperModel` from `faster_whisper` (already installed)
- Calls `model.transcribe(wav_path, word_timestamps=True)`
- Collects all `segment.words` across all segments
- Prints JSON array to stdout: `[{"word": str, "start": float, "end": float}, ...]`
- Exits 0 on success, non-zero on failure
- Never prints anything to stdout except the final JSON (errors go to stderr)

Uses the `tiny` model for speed (loads in <1s on GPU; transcription of a 3–5s clip takes ~0.1–0.3s). The same Python environment used by GPT-SoVITS training ASR is used here.

### New: `src/services/wordAligner.js`

```js
export async function alignWords(wavPath) → wordTimestamps[] | null
```

- Spawns `align_words.py` as a child process via the existing `PYTHON_EXEC` and the same path injection pattern used by `processManager.js`
- Collects stdout, parses JSON
- Times out after 30s; returns `null` on timeout or non-zero exit
- Never throws — caller always gets `wordTimestamps | null`

### Modified: `src/services/longTextInference.js`

`synthesizeLongTextStreaming`:
- After `final.wav` is written and before firing `inference-complete`, call `alignWords(finalPath)`
- Include result in `inference-complete` payload: `{ ..., wordTimestamps: [...] | null }`

`synthesizeLongText`:
- After building `finalBuffer`, call `alignWords` on a temp path
- Return `{ audioBuffer, chunks, wordTimestamps }` (wordTimestamps may be null)

### Modified: `src/routes/inference.js`

`POST /inference/tts` (used by live chat per-phrase synthesis):
- After `inferenceServer.synthesize()` returns the WAV buffer, write it to a temp file, call `alignWords`, delete temp file
- Add `X-Word-Timestamps` response header with `JSON.stringify(wordTimestamps)` (or `"null"` if alignment failed)
- WAV body unchanged — backwards compatible

---

## Frontend Changes (client)

### New: `src/components/WordTimestampPlayer.jsx`

Props:
- `audioBlob` — Blob (same as current AudioPlayer)
- `wordTimestamps` — `Array<{word, start, end}> | null`
- `transcript` — `string` (full text, used as fallback if timestamps null)

Layout:
```
┌──────────────────────────────────────────────────┐
│  The quick brown [fox] jumps over the lazy dog.  │  ← highlighted transcript (top)
├──────────────────────────────────────────────────┤
│  ▶ ──────────────── 0:03 / 0:08                  │  ← HTML audio element
│  [Download WAV]                                   │
└──────────────────────────────────────────────────┘
```

Behaviour:
- Renders words as individual `<span>` elements separated by spaces
- Attaches `timeupdate` event to the `<audio>` ref
- On each tick: binary-search `wordTimestamps` for the entry where `start ≤ currentTime < end`
- Sets `activeWordIndex`; the matching span gets a highlight class (yellow/sky background)
- When audio ends or is paused, active index resets to -1
- If `wordTimestamps` is null, renders `transcript` as plain text (no spans, no highlighting)
- If both `wordTimestamps` and `transcript` are absent, falls back to plain audio player (current behaviour)

This component replaces `AudioPlayer` on the InferencePage. `AudioPlayer` itself is not deleted (may be used elsewhere).

### Modified: `src/hooks/useInferenceSSE.js`

Captures `wordTimestamps` from the `inference-complete` event and exposes it as part of the hook's return value.

### Modified: `src/pages/InferencePage.jsx`

- Receive `wordTimestamps` from `useInferenceSSE`
- Maintain `inferenceTranscript` state (join chunk texts as they arrive via `inference-start` event, which already sends `chunks: [{index, text}]`)
- Pass `audioBlob`, `wordTimestamps`, `transcript` to `WordTimestampPlayer` in the Generate card (section 05), replacing `AudioPlayer`
- No new section, no layout change beyond replacing the player component

### Modified: `src/hooks/useLiveSpeech.js`

- After each `synthesize` / `synthesizeSentence` call, read `response.headers['x-word-timestamps']`
- Parse JSON; store `wordTimestamps` per message in the messages array
- Each message object gains an optional `wordTimestamps` field

### Modified: `src/pages/LivePage.jsx` — `ChatBubble` component

- For AI messages (`role === 'assistant'`), if the message has `audioUrl` and `wordTimestamps`, render a small `WordTimestampPlayer` inside the bubble instead of a plain `<audio>` tag
- The `transcript` prop is sourced from `message.text` (the AI's reply text, already stored per message)
- No new sections, no layout changes outside the bubble

---

## Error Handling

| Failure | Behaviour |
|---------|-----------|
| `align_words.py` not found | `alignWords` returns `null`; synthesis result unaffected |
| faster-whisper model load error | Python exits non-zero; `alignWords` returns `null` |
| Alignment timeout (>30s) | `alignWords` returns `null` |
| Empty `wordTimestamps` array | Frontend shows plain transcript |
| `X-Word-Timestamps` header missing/malformed | `useLiveSpeech` treats as `null`; audio plays normally |

Alignment failure is never surfaced as a user-visible error — it silently degrades to no highlighting.

---

## Deployment Constraints

- **Two CloudFronts unchanged**: one for the main app (training + inference client), one for the live gateway. This feature touches only the gpu-inference-worker and existing client pages.
- **No new pages**: all changes are inside existing page components and existing UI cards/sections.
- `align_words.py` is deployed as part of the gpu-inference-worker container (not the live-gateway container).
- The `X-Word-Timestamps` header must be exposed via CORS if the client is on a different origin (add to `Access-Control-Expose-Headers`).

---

## Open Questions

None — all design decisions resolved during brainstorming.
