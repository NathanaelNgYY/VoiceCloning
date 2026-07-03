# Shared Chatbot System Prompt — Design

**Date:** 2026-07-03
**Status:** Approved (pending spec review)

## Goal

Make the chatbot system prompt a **single shared value** instead of a
per-browser one. Today an edit is saved to the editing browser's
`localStorage`, so it only affects that one browser. We want: whoever edits the
prompt sets it for **every** visitor of the chatbot site.

The change moves only the **persistence** of the base system prompt from
per-browser `localStorage` to the shared `live-gateway` server that every client
already connects to. Everything else — combining the prompt with per-user PDF
documents (`chatbotCombinedSystemPrompt`) and sending the combined value via the
`session.init` handshake on WebSocket open — is unchanged.

## Decisions (from brainstorming)

- **Edit access:** anyone using the chatbot panel can edit and save. No auth /
  admin gating. Last-write-wins.
- **Durability:** the shared prompt is persisted to a JSON file on disk so it
  survives a gateway restart/redeploy. On a fresh host with no file, the store
  is "unset" and clients fall back to the baked-in default.
- **Save is a manual action** (Save button / on-blur), not save-on-keystroke.
- **"Reset to default" resets the shared prompt for everyone** (it PUTs the
  baked-in default), not just the local browser.

## Key constraint: per-distribution (CloudFront) isolation

There are two client builds behind two CloudFront distributions:

- the **chatbot build** (`kiosk` mode, `VITE_APP_MODE=chatbot`, `dist-chatbot`)
- the **main Live Voice Chat app** (non-kiosk)

Both connect to the **same shared `live-gateway`**. The original system-prompt
panel spec (2026-06-29) preserved isolation at build time; this change must
preserve it too. It does, because of two hard guarantees:

1. **The gateway store is passive — it never injects the prompt into a
   connection.** It is a key-value box that the chatbot editor reads (`GET`) and
   writes (`PUT`). The prompt that actually drives any OpenAI Realtime session
   still comes **only** from that connection's `session.init` message, exactly as
   today. The gateway's connect path (`liveChat.js`) is **not** changed to read
   the store.

2. **All GET / PUT / load / save logic is gated behind `kiosk`** — the same gate
   the panel already uses. The main-app build compiles none of it into its
   bundle.

Resulting per-build behavior:

- **Chatbot build (kiosk):** the only build that calls `GET`/`PUT`, loads the
  shared value into the panel, and sends the combined prompt via `session.init`.
  It reads and writes the shared box.
- **Main Live app build (non-kiosk):** never renders the panel, never calls
  `GET`/`PUT`, still sends `systemPrompt: ''`. The gateway sees an empty prompt
  and keeps its server-side `OPENAI_REALTIME_SYSTEM_PROMPT` default. It never
  reads the shared box.

Net effect: the shared box only changes **where the chatbot editor persists its
prompt**. It adds **no** new shared server state that main-app connections ever
read. The other CloudFront distribution is untouched.

## Components & changes

### 1. Gateway store — `live-gateway/src/services/systemPromptStore.js` (new)

- Holds the current shared prompt in memory.
- `load()` on startup: read the JSON file at `SYSTEM_PROMPT_STORE_PATH` if it
  exists; otherwise remain "unset" (`null`).
- `get()` → `string | null`.
- `set(value)` → update memory and write the JSON file (`{ systemPrompt }`).
  Best-effort file write with error surfaced to the caller so the route can
  return a proper status.
- Last-write-wins; no locking (single-instance EC2 deployment).

### 2. Gateway config — `live-gateway/src/config.js`

- Add `SYSTEM_PROMPT_STORE_PATH` (default e.g. `./data/system-prompt.json`).
  Document it in `.env.livegateway.deployment` / config catalog.

### 3. Gateway routes — `live-gateway/src/routes/systemPrompt.js` (new), mounted in `index.js`

- `GET /api/live/chat/system-prompt` → `{ systemPrompt: store.get() }` (may be
  `null`).
- `PUT /api/live/chat/system-prompt` with body `{ systemPrompt: string }`:
  validate it is a string, `store.set()`, return `{ systemPrompt }`. On write
  failure return 500.
- CORS already applied globally in `index.js` (`cors({ origin: CORS_ORIGIN })`).
- `liveChat.js` (the WebSocket connect path) is **not** modified — see isolation
  guarantee #1.

### 4. Client runtime config — `client/src/lib/runtimeConfig.js`

- Add `resolveLiveGatewayHttpPath(pathname)` mirroring `resolveWsPath`'s base
  resolution (`VITE_LIVE_GATEWAY_URL` → `VITE_GPU_WORKER_URL` → api origin →
  `window.location.origin`) but keeping the `http`/`https` scheme. Used for the
  GET/PUT of the shared prompt against the gateway origin.

### 5. Client prompt module — `client/src/lib/chatbotSystemPrompt.js`

- Keep `DEFAULT_CHATBOT_SYSTEM_PROMPT`, `getDefaultChatbotSystemPrompt()`
  (env → hardcoded default).
- Replace the `localStorage` functions with server-backed async ones:
  - `fetchSharedChatbotSystemPrompt()` → `GET`; returns the stored string, or
    `getDefaultChatbotSystemPrompt()` when the server returns `null` or the
    request fails.
  - `saveSharedChatbotSystemPrompt(value)` → `PUT`; returns the saved value or
    throws on failure (so the UI can show an error).
- Remove `CHATBOT_SYSTEM_PROMPT_STORAGE_KEY`, `resolveChatbotSystemPrompt`,
  `persistChatbotSystemPrompt`, `clearChatbotSystemPrompt` (localStorage) — or
  keep them only if still referenced elsewhere (grep first).

### 6. Client page — `client/src/pages/LivePage.jsx` (kiosk only)

- Replace the synchronous initializer
  `useState(() => (kiosk ? resolveChatbotSystemPrompt() : ''))` with:
  - initial state = baked-in default (or `''` when not kiosk), then
  - on mount (kiosk only) `fetchSharedChatbotSystemPrompt()` and set state.
- Save handler (currently `persistChatbotSystemPrompt(value)`): call
  `saveSharedChatbotSystemPrompt(value)`; on rejection show a small inline error
  / status near the panel and keep the edit in the textarea.
- "Reset to default": set textarea to the baked-in default **and**
  `saveSharedChatbotSystemPrompt(default)` so the shared value resets for
  everyone.
- Save is triggered manually (Save button / on-blur), not per keystroke. The
  textarea remains disabled while a conversation is active, as today.
- Per-user PDF documents and `chatbotCombinedSystemPrompt` are unchanged; the
  combined value is still what goes out via `session.init`.

## Data flow

```
[chatbot build only, kiosk]
mount ─▶ GET /api/live/chat/system-prompt ─▶ store.get()  (null → baked default)
        ▼
   Textarea (LivePage)
        │ edit + Save
        ▼ PUT { systemPrompt }
   gateway store.set() ─▶ writes SYSTEM_PROMPT_STORE_PATH (shared, durable)

start conversation:
   chatbotCombinedSystemPrompt (shared prompt + per-user docs)
        ▼ on WS open
   { type:'session.init', systemPrompt } ─▶ liveChat.js applies to THIS bridge only
        ▼
   OpenAiRealtimeBridge → OpenAI Realtime

[main Live app build, non-kiosk — the other CloudFront]
   no panel, no GET/PUT
   { type:'session.init', systemPrompt:'' } ─▶ gateway keeps OPENAI_REALTIME_SYSTEM_PROMPT
   never reads the shared store  → unaffected
```

## Error handling

- `GET` fails / gateway unreachable → fall back to baked-in default; textarea
  still usable (session-only until a successful save).
- `PUT` fails → surface an inline error/status near the panel (shared state, so a
  silent failure would mislead); keep the edit in the textarea.
- Empty/whitespace prompt → gateway stores it, but the existing `session.init`
  logic in `liveChat.js` already keeps the OpenAI default when the sent prompt is
  blank, so runtime behavior stays safe.
- Store file missing/corrupt on startup → treat as unset (`null`); do not crash.

## Testing

- `live-gateway/src/services/systemPromptStore.test.js` (new): unset → `get()`
  returns `null`; `set()` then `get()` returns value; `set()` persists to the
  file; `load()` restores from an existing file; corrupt/missing file → `null`.
- `live-gateway/src/routes/systemPrompt.test.js` (new): `GET` returns stored
  value / `null`; `PUT` validates body and persists; non-string body rejected.
- `live-gateway/src/routes/liveChat.test.js`: **isolation regression** — assert
  that an empty `session.init` still yields the OpenAI default even when the
  shared store holds a value (the connect path must not read the store).
- `client/src/lib/chatbotSystemPrompt.test.js` (node:test): `fetch` resolution
  (server value / `null` → default / error → default); `save` posts and returns
  value / throws on failure. (Mock `fetch`.)

## Out of scope (YAGNI)

- No auth / admin gating (anyone can edit — explicit decision).
- No multi-prompt management or history; one shared prompt.
- No S3 (file-on-disk chosen); no change to per-user PDF documents or the Gemini
  path.
- No change to the `live-gateway` WebSocket connect path beyond the isolation
  regression test.
