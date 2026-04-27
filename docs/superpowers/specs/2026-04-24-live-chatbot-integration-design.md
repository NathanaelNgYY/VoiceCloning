# Live Chatbot Integration With OpenAI Realtime

**Date:** 2026-04-24  
**Branch:** chatbot-integrationV1  
**Status:** Historical design. See `docs/live-chatbot-handoff.md` for the current implementation state as of 2026-04-27.

## Current Implementation Note

The implemented Live chatbot has moved beyond this original V1 design:

- `/live` is now `Live Full`: OpenAI Realtime generates English assistant text, then the full reply is synthesized once through `POST /api/inference`.
- `/live-fast` is now `Live Fast`: OpenAI Realtime generates English assistant text, then the frontend splits by punctuation and synthesizes each phrase through `POST /api/live/tts-sentence`.
- The UI is a chatbot transcript with user and assistant bubbles.
- User speech transcription for display comes from OpenAI Realtime input transcription.
- Cloned playback interruption is local only; the frontend should not send `response.cancel` when stopping GPT-SoVITS audio.
- Cloud deployments must either route `/api/*` WebSocket upgrades through CloudFront to the backend or set `VITE_API_BASE_URL` to the backend origin.

Read `docs/live-chatbot-handoff.md` before doing new Live development.

## Problem

The current Live tab is a speech-to-speech clone demo:

```text
Browser mic -> local browser phrase detection -> Faster Whisper transcription -> GPT-SoVITS synthesis -> cloned voice audio
```

The new use case is a live AI conversation. The user speaks to an assistant, the assistant answers conversationally, and the answer is rendered only through the selected cloned voice. Training and the normal Inference page must remain untouched unless a route boundary has to be shared.

## Decision

Use **OpenAI gpt-realtime** for the Live tab conversation brain in V1.

Reasons:

- OpenAI Realtime supports audio input, text output, and built-in voice activity detection.
- The project already has the correct final stage for voice cloning: text into `/live/tts-sentence`.
- A backend-owned OpenAI session keeps `OPENAI_API_KEY` out of the browser.
- The same frontend flow works in local mode and cloud/S3 mode because GPT-SoVITS synthesis is already abstracted behind existing backend routes.
- Gemini Live remains a future option, but its native audio models are more naturally audio-output first and would require output transcription before GPT-SoVITS.

## Architecture

The Live tab will use a backend-owned OpenAI Realtime bridge.

```text
Browser mic
  -> backend WebSocket /api/live/chat/realtime
  -> OpenAI gpt-realtime with VAD and session memory
  -> assistant text response
  -> browser receives assistant text
  -> existing POST /api/live/tts-sentence
  -> GPT-SoVITS cloned voice audio
  -> browser plays cloned voice only
```

OpenAI is responsible for listening, turn detection, conversation memory, and generating assistant text. GPT-SoVITS remains responsible for every audible assistant reply.

## Local And Cloud Behavior

The frontend always connects to the backend for the OpenAI Realtime bridge.

In local mode:

- The backend opens the OpenAI Realtime session.
- `/live/tts-sentence` synthesizes through the local GPT-SoVITS inference server.

In cloud/S3 mode:

- The backend still opens the OpenAI Realtime session.
- `/live/tts-sentence` continues to use the existing remote inference path through the GPU worker.

No OpenAI API key is exposed to the frontend in either mode.

## Backend Components

### `server/src/services/openaiRealtimeBridge.js`

Owns the OpenAI Realtime WebSocket connection for one live session.

Responsibilities:

- Connect to OpenAI with `OPENAI_API_KEY`.
- Configure `OPENAI_REALTIME_MODEL`, defaulting to `gpt-realtime`.
- Configure VAD, defaulting to semantic VAD if supported by the chosen model.
- Configure text response output only.
- Apply a casual ChatGPT-like system prompt.
- Forward browser audio chunks into OpenAI.
- Translate OpenAI events into stable app events.
- Close the OpenAI session when the user stops the live session.

### `server/src/routes/liveChat.js`

Exposes the browser-facing WebSocket endpoint:

```text
/api/live/chat/realtime
```

Responsibilities:

- Accept the frontend WebSocket.
- Create one `openaiRealtimeBridge` per frontend session.
- Validate that OpenAI configuration exists.
- Forward frontend audio/control messages to the bridge.
- Send frontend-safe events back to the browser.
- Clean up OpenAI and browser sockets on close or error.

### `server/src/config.js`

Add OpenAI Live configuration:

```env
OPENAI_API_KEY=
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VAD=semantic_vad
OPENAI_REALTIME_SYSTEM_PROMPT=You are a casual, helpful assistant. Keep replies concise and conversational.
```

The server should still start without `OPENAI_API_KEY`. Live chat should report a clear disabled/error state when the key is missing.

## Frontend Components

### `client/src/hooks/useLiveSpeech.js`

Refactor the Live hook so it no longer uses Faster Whisper for Live conversation turns.

Responsibilities:

- Start microphone capture when the live conversation starts.
- Stream audio chunks to the backend WebSocket.
- Receive OpenAI-backed conversation events from the backend.
- Display assistant text as it arrives.
- Queue completed assistant text for cloned-voice synthesis through `synthesizeSentence()`.
- Manage interruption behavior while cloned audio is playing.
- Close the WebSocket and microphone cleanly when the user stops.

### `client/src/pages/LivePage.jsx`

Update copy and controls from phrase transcription to conversation mode.

The existing model/reference-audio readiness checks stay:

- A loaded model is required.
- A reference audio path and prompt are required.
- The user is directed to Inference if either is missing.

## Removed From The Live Path

The Live tab no longer needs:

- `transcribeLivePhrase()`
- `/live/transcribe-phrase`
- `liveTranscriber`
- `faster_whisper_worker.py` for live phrase transcription
- The browser-side silence slider and RMS phrase cutoff as the primary turn detector

The general `/transcribe` endpoint should remain because the Inference page still uses auto-transcription for reference audio.

Any Faster Whisper deletion must be scoped carefully so training, dataset preparation, and Inference auto-transcribe are not affected.

## Session State

Frontend session states:

```text
idle -> connecting -> listening -> thinking -> speaking/listening -> stopping -> idle
```

State meanings:

- `idle`: no live session is active.
- `connecting`: backend and OpenAI Realtime session are being established.
- `listening`: microphone is open and OpenAI VAD is deciding turns.
- `thinking`: OpenAI has accepted a user turn and is generating assistant text.
- `speaking/listening`: GPT-SoVITS is generating or playing cloned voice, with microphone streaming paused.
- `stopping`: frontend is closing microphone, WebSocket, and queued work.

## Backend Events

The backend should expose stable app-level events instead of leaking raw OpenAI event names to the frontend.

Events:

- `session.ready`: OpenAI Realtime session is connected and configured.
- `user.speech.started`: OpenAI VAD detected the start of user speech.
- `user.speech.stopped`: OpenAI VAD detected the end of user speech.
- `assistant.text.delta`: optional text delta for display.
- `assistant.text.done`: final assistant text to synthesize.
- `error`: user-safe error message.
- `session.closed`: live session has ended.

## Conversation Memory

Conversation memory is session-scoped for V1.

The OpenAI Realtime session stays open from `Start conversation` until `Stop conversation`. Multi-turn context naturally lives inside that OpenAI session. When the user stops the session, the backend closes the OpenAI session and memory resets.

Persistent history is out of scope for V1.

## Audio And Interruption Behavior

Only GPT-SoVITS cloned voice audio is played to the user.

OpenAI audio output is not requested and is never played.

The Live tab uses a half-duplex rule for V1:

- While the assistant is speaking in cloned voice, microphone streaming to OpenAI pauses so the AI does not hear its own cloned response.
- If the user starts speaking or taps the mic while cloned audio is playing, playback stops immediately and the app returns to listening.
- The UI must tell the user that listening pauses while cloned voice is playing.

Suggested user-facing copy:

```text
The AI listens while you speak. When the cloned voice is playing, listening pauses. Speak again or tap the mic to interrupt.
```

Status labels:

- `Listening...`
- `Thinking...`
- `Speaking in cloned voice...`
- `Paused while cloned voice is playing`
- `You interrupted. Listening...`

## UI Changes

The large mic button becomes a session control:

- `Start conversation`
- `Stop conversation`

The generated clip list remains, renamed to `Conversation Replies`.

Each reply entry should show:

- Assistant text.
- Generation status.
- Cloned audio playback/download controls when ready.

The Live tab should no longer show Faster Whisper messaging or a silence-before-inference slider.

## Error Handling

OpenAI errors:

- Show `AI conversation failed` plus a concise detail.
- Stop the current live session if the bridge cannot recover.
- Do not touch loaded voice models or reference audio.

Missing `OPENAI_API_KEY`:

- Server starts normally.
- Live chat connection fails with a clear configuration message.
- The Live tab shows that AI conversation is not configured.

GPT-SoVITS busy or synthesis errors:

- Keep the assistant text in `Conversation Replies`.
- Mark the affected reply as failed.
- Retry synthesis only for transient busy/conflict errors using the existing retry pattern.

WebSocket disconnect:

- Stop microphone capture.
- Clear active transient state.
- Let the user start a new session.

No model or reference audio:

- Keep the existing disabled Live state and link to Inference.

## Testing And Verification

Required verification:

- `client` production build still succeeds.
- `server` starts without `OPENAI_API_KEY`.
- Local mode can connect Live to the backend OpenAI bridge and synthesize with local GPT-SoVITS.
- Cloud/S3 mode uses the same OpenAI bridge and existing `/live/tts-sentence` GPU worker path.
- Inference page auto-transcribe remains functional.
- Training routes remain untouched.
- Live tab no longer calls Faster Whisper phrase transcription.

Useful targeted tests if a test harness is added:

- OpenAI raw event parsing maps to stable backend events.
- Missing API key returns a clear Live-specific error.
- `assistant.text.done` queues exactly one cloned-voice synthesis job.
- User interruption stops current cloned playback and resumes listening.

## Out Of Scope

- Gemini fallback.
- Persistent chat history after a live session ends.
- OpenAI audio playback.
- Changing GPT-SoVITS inference settings or training quality.
- Reworking the normal Inference page.
- Reworking training or dataset preparation.
