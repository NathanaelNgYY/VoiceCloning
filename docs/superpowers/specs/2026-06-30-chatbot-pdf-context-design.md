# Chatbot PDF Context — Design Spec

**Date:** 2026-06-30
**Status:** Proposed (awaiting review)
**Branch:** `chatbot-live-full` (extends the kiosk chatbot)

## Goal

Let a kiosk operator upload PDF documents whose text is fed to the chatbot as
additional reference material, appended to the editable system prompt. Entirely
client-side: the kiosk already sends the system prompt to the Live Gateway via
the `session.init` handshake, so it sends `instructions + document text` as one
combined string. No gateway, Lambda, S3, or EC2 change.

## Background — current state

- `client/src/lib/chatbotSystemPrompt.js` holds the default prompt + localStorage
  helpers (`resolveChatbotSystemPrompt`, `persistChatbotSystemPrompt`,
  `clearChatbotSystemPrompt`).
- `LivePage` (kiosk mode) renders the "Assistant instructions" panel editing
  `chatbotSystemPrompt`, and passes `systemPrompt: kiosk ? chatbotSystemPrompt : ''`
  to `useLiveSpeech`, which threads it into the `session.init` message.
- The gateway sets `bridge.systemPrompt` from that string → OpenAI Realtime
  `session.update` instructions. It imposes no length limit and needs no change.

## Approach

Client-side text extraction with `pdfjs-dist`. Rejected: backend/server-side
extraction (adds S3/Lambda/EC2 infra for no benefit at "tens of pages" scale).

## Components

### New module `client/src/lib/chatbotDocuments.js`

One responsibility: documents → a context string. Mirrors the
`chatbotSystemPrompt` helper shape.

- `STORAGE_KEY = 'chatbot.documents'`.
- `MAX_DOCUMENTS_CHARS = 100000` — ~25k tokens; the cap on combined document text.
- `extractPdfText(file)` → `Promise<{ name: string, text: string, chars: number }>`.
  Uses `pdfjs-dist` to read the text layer of every page, joined with newlines.
  Throws on non-PDF / corrupt input. If the PDF has no text layer (scanned
  image), resolves with `text: ''` (caller treats empty as "no extractable text").
- `resolveChatbotDocuments()` → `Array<{name,text,chars}>` from localStorage
  (`[]` on absence/parse error/unavailable storage).
- `persistChatbotDocuments(docs)` → best-effort localStorage write; returns
  `{ ok: boolean }` (`ok:false` on quota exceeded).
- `addChatbotDocument(docs, doc)` → new array (replaces any same-`name` entry).
- `removeChatbotDocument(docs, name)` → new array without that entry.
- `clearChatbotDocuments()` → removes the storage key.
- `buildDocumentsContext(docs, { maxChars = MAX_DOCUMENTS_CHARS } = {})` →
  `{ text: string, truncated: boolean, totalChars: number }`. When there are no
  docs, `text` is `''`. Otherwise builds:
  ```
  # Uploaded Reference Documents
  Treat the following as additional approved reference material. Use it the same
  way as the approved material above. Do not invent details beyond it.

  ## <name1>
  <text1>

  ## <name2>
  <text2>
  ```
  joined text is truncated to `maxChars` (whole result, not per-doc); `truncated`
  is true when trimming occurred.
- `combineSystemPromptWithDocuments(prompt, docsContext)` → `prompt` when
  `docsContext` is empty, else `` `${prompt}\n\n${docsContext}` ``.

### UI — extend the kiosk "Assistant instructions" panel (`LivePage.jsx`)

Kiosk-only (same `kiosk` gating as the system-prompt textarea). Below the
textarea, a "Reference documents" area:
- A PDF file input (`accept="application/pdf"`, multiple allowed).
- The list of attached docs: each row shows name + char count + a remove (✕)
  button.
- A total-size indicator and an over-cap warning when `totalChars > MAX_DOCUMENTS_CHARS`.
- A "no extractable text" inline notice if an uploaded PDF yields empty text.
- The whole area is disabled while a conversation is active
  (`isConversationActive`), matching the textarea.

State: `const [chatbotDocuments, setChatbotDocuments] = useState(() => (kiosk ? resolveChatbotDocuments() : []))`.
Handlers persist via `persistChatbotDocuments` after add/remove (mirroring the
prompt panel's persist-on-change).

### Wiring

In `LivePage` kiosk mode, replace the `systemPrompt` passed to `useLiveSpeech`:
```js
systemPrompt: kiosk
  ? combineSystemPromptWithDocuments(
      chatbotSystemPrompt,
      buildDocumentsContext(chatbotDocuments).text,
    )
  : '',
```
Nothing downstream changes.

### pdfjs worker (Vite)

Set `pdfjsLib.GlobalWorkerOptions.workerSrc` from
`import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` so the worker
loads correctly under Vite in both dev and the `build:chatbot` output.

## Data flow

Operator picks PDF → `extractPdfText` → add to `chatbotDocuments` → persist →
on conversation start, `buildDocumentsContext` + `combineSystemPromptWithDocuments`
produce the `systemPrompt` → `session.init` → gateway → Realtime instructions.

## Error handling

- Non-PDF / corrupt → inline error; doc not added.
- Empty text layer (scanned image) → "No extractable text (scanned image?)";
  doc not added.
- localStorage quota exceeded on persist → warn; keep docs in memory for the
  session.
- Over the char cap → docs still usable; context is truncated and the UI warns.

## Testing (`node:test`, pure functions)

- `buildDocumentsContext`: empty list → `''`; format includes the header and per-doc
  `## name`; truncation to `maxChars` sets `truncated:true`; `totalChars` correct.
- `combineSystemPromptWithDocuments`: empty docs context returns the prompt
  unchanged; non-empty appends with a blank-line separator.
- list helpers (`addChatbotDocument` replace-by-name, `removeChatbotDocument`,
  `resolveChatbotDocuments` with an injected/mocked storage).
- `extractPdfText` (pdfjs binary parsing) is verified manually in the kiosk —
  consistent with this client's no-jsdom `node:test` setup.

## Out of scope

- Retrieval / embeddings (not needed at this scale).
- Non-PDF formats (docx, txt).
- OCR for scanned PDFs.
- Any backend / gateway / EC2 change.
- Non-kiosk builds.

## Open parameter

- `MAX_DOCUMENTS_CHARS = 100000` (~25k tokens). Larger raises per-session cost,
  latency, and dilutes instruction adherence, since the text is sent every
  conversation. Adjust the constant if a different ceiling is wanted.
