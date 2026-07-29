# Chatbot System Prompt Panel — Design

**Date:** 2026-06-29
**Status:** Approved (pending spec review)

## Goal

Add an editable text box beside the chatbot conversation that holds a system
prompt (initially the GI-bleeding student-education prompt) and **actually
drives the AI's behavior** for that conversation. The prompt must apply **only
to the chatbot build / distribution** — the main Live Voice Chat app and its
CloudFront distribution must be completely unaffected.

## Key constraint: per-distribution isolation

The `live-gateway` WebSocket server is shared by all clients, but the OpenAI
Realtime system prompt is set **per WebSocket connection** (in
`buildRealtimeSessionUpdate`, sent on socket open). Isolation therefore happens
at **build time**, not server time:

- The GI-bleeding prompt lives only in the chatbot build (`.env.chatbot`,
  compiled into `dist-chatbot`), and the UI/send logic is gated behind `kiosk`
  mode (`APP_MODE_CONFIG.kiosk`, i.e. `VITE_APP_MODE=chatbot`).
- The chatbot connection sends its prompt; the gateway applies it to **that one
  connection only**.
- Every other build sends an empty prompt → the gateway keeps the existing
  server-side default `OPENAI_REALTIME_SYSTEM_PROMPT`. No shared server state
  changes; the other CloudFront distribution is untouched.

## Components & changes

### 1. Chatbot build default — `client/.env.chatbot`

Add `VITE_CHATBOT_SYSTEM_PROMPT` containing the GI-bleeding prompt. Only the
`dist-chatbot` bundle receives it. (Multi-line value stored as a single env
entry.)

### 2. UI panel — `client/src/pages/LivePage.jsx` (kiosk only)

- When `kiosk` is true, render the chat panel and a new prompt panel in a
  2-column layout (chat left, prompt right; stacks on narrow screens). When
  `kiosk` is false, layout and behavior are unchanged — the panel never renders.
- The panel is an editable `<Textarea>` labeled as the assistant's instructions,
  pre-filled from the resolved prompt value.
- **Persistence:** edits are saved to `localStorage` (key e.g.
  `chatbot.systemPrompt`) and survive reloads. A "Reset to default" link
  restores the baked-in `VITE_CHATBOT_SYSTEM_PROMPT`.
- Resolution order for the initial value: `localStorage` override →
  `VITE_CHATBOT_SYSTEM_PROMPT` → empty.
- The textarea is disabled while a conversation is active
  (`isConversationActive`), matching the existing controls — the prompt only
  takes effect on the next conversation start.

A small helper module (e.g. `client/src/lib/chatbotSystemPrompt.js`) owns:
default resolution from env, localStorage read/write, and reset. Keeps
`LivePage` thin and is unit-testable in isolation.

### 3. Hook — `client/src/hooks/useLiveSpeech.js`

- Accept a new `systemPrompt` param (default `''`).
- Read through a ref (like `voiceProfileId`) so the value captured at
  `start()` is used for the session.
- On socket open (`onOpen`), send exactly one handshake message:
  `{ type: 'session.init', systemPrompt }` before any audio.

### 4. Socket — `client/src/services/liveChatSocket.js`

No shape change. The existing `send()` forwards the `session.init` payload.
(`onOpen` already exposed.)

### 5. Gateway — `live-gateway/src/routes/liveChat.js`

- On `wss.on('connection')`, **do not** call `bridge.connect()` immediately.
- Wait for the first browser message:
  - If `{ type: 'session.init' }`: if `systemPrompt` is a non-empty string,
    set `bridge.systemPrompt = message.systemPrompt`; then `bridge.connect()`.
  - Safety timeout (~1000 ms): if no `session.init` arrives, `bridge.connect()`
    with the default so a misbehaving/legacy client cannot hang.
- After connect, message handling proceeds exactly as today
  (`handleBrowserMessage`). `session.init` received after connect is ignored.

### 6. Bridge — `live-gateway/src/services/openaiRealtimeBridge.js`

Already accepts `systemPrompt` in its constructor and uses
`this.systemPrompt` in `buildRealtimeSessionUpdate`. The route sets
`bridge.systemPrompt` before `connect()`, so no change is required here beyond
confirming the field is read at connect time (it is — set in `socket.on('open')`).

## Data flow

```
[chatbot build only]
Textarea (LivePage, kiosk) ──state──▶ useLiveSpeech(systemPrompt)
   │ default: localStorage → VITE_CHATBOT_SYSTEM_PROMPT
   ▼ on WS open
{ type:'session.init', systemPrompt } ──▶ liveChatSocket.send
   ▼
gateway liveChat.js: defer connect → set bridge.systemPrompt → bridge.connect()
   ▼
OpenAiRealtimeBridge → buildRealtimeSessionUpdate({ systemPrompt }) → OpenAI Realtime

[main app build]
useLiveSpeech(systemPrompt='') → { type:'session.init', systemPrompt:'' }
   ▼
gateway: empty → keep OPENAI_REALTIME_SYSTEM_PROMPT (server default) → unchanged
```

## Error handling

- Empty/whitespace `systemPrompt` → gateway keeps the env default (never sends
  an empty instruction set to OpenAI).
- No `session.init` within the timeout → connect with default (no hang).
- `localStorage` unavailable (private mode) → fall back to env default, edits
  are session-only; no crash.

## Testing

- `live-gateway/src/routes/liveChat.test.js`: deferred connect; `session.init`
  with a prompt overrides `bridge.systemPrompt`; empty prompt keeps default;
  timeout path connects with default.
- `live-gateway/src/services/openaiRealtimeBridge.test.js`: confirm
  `buildRealtimeSessionUpdate` uses an overridden `systemPrompt`.
- `client/src/lib/chatbotSystemPrompt.test.js` (Vitest): resolution order,
  localStorage persistence, reset-to-default.

## Out of scope (YAGNI)

- No server-side storage or admin API for prompts.
- No per-user / multi-prompt management; one editable prompt per chatbot build.
- No change to the Gemini bridge (chatbot uses the OpenAI Realtime path).
```

