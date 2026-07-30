# Chatbot PDF Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a kiosk operator upload PDFs whose extracted text is appended to the chatbot system prompt (sent via the existing `session.init` handshake), persisted in localStorage.

**Architecture:** Pure document logic (build/combine/list/storage + cap) lives in `client/src/lib/chatbotDocuments.js` (unit-tested with node:test). PDF text extraction (which needs pdfjs's Vite-only worker import) is isolated in `client/src/lib/chatbotPdf.js` (manually verified — keeping it separate stops the node:test suite from importing a Vite-only `?url` module). `LivePage` (kiosk only) gains a "Reference documents" sub-panel and combines prompt + document text before passing it to `useLiveSpeech`. No gateway/backend change.

**Tech Stack:** React 18 + Vite 5 (client), `pdfjs-dist` v4, `node:test` (NOT Vitest), ES modules.

## Global Constraints

- ES modules only.
- Client tests run with `node --test "src/**/*.test.js"` from the `client/` directory — NOT Vitest, no jsdom, pure-function tests only. (`client` has no `npm test` script.)
- Feature is kiosk-only — gated on `kiosk` (`APP_MODE_CONFIG.kiosk`), matching the existing system-prompt panel.
- `MAX_DOCUMENTS_CHARS = 100000` — the cap on combined document context text (verbatim).
- localStorage key for documents: `chatbot.documents` (verbatim).
- Do NOT modify the gateway, Lambda, gpu-* workers, or any non-client code.
- Pre-existing stray ` M client/package-lock.json` in the working tree — never stage/revert it. `npm install` may modify it further; leave it unstaged.
- Branch: `chatbot-live-full`.

---

### Task 1: Pure document helpers

**Files:**
- Create: `client/src/lib/chatbotDocuments.js`
- Test: `client/src/lib/chatbotDocuments.test.js`

**Interfaces:**
- Produces:
  - `CHATBOT_DOCUMENTS_STORAGE_KEY: string` (`'chatbot.documents'`)
  - `MAX_DOCUMENTS_CHARS: number` (`100000`)
  - `resolveChatbotDocuments() -> Array<{name,text,chars}>`
  - `persistChatbotDocuments(docs) -> {ok: boolean}`
  - `clearChatbotDocuments() -> void`
  - `addChatbotDocument(docs, doc) -> Array` (replaces same-`name`)
  - `removeChatbotDocument(docs, name) -> Array`
  - `buildDocumentsContext(docs, {maxChars?}) -> {text, truncated, totalChars}`
  - `combineSystemPromptWithDocuments(prompt, docsContext) -> string`

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/chatbotDocuments.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_DOCUMENTS_CHARS,
  resolveChatbotDocuments,
  persistChatbotDocuments,
  addChatbotDocument,
  removeChatbotDocument,
  buildDocumentsContext,
  combineSystemPromptWithDocuments,
} from './chatbotDocuments.js';

function withMemoryStorage(fn) {
  const store = new Map();
  const prev = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  try { return fn(); } finally { globalThis.localStorage = prev; }
}

test('buildDocumentsContext returns empty for no docs', () => {
  const r = buildDocumentsContext([]);
  assert.equal(r.text, '');
  assert.equal(r.truncated, false);
  assert.equal(r.totalChars, 0);
});

test('buildDocumentsContext includes header and per-doc sections', () => {
  const r = buildDocumentsContext([{ name: 'a.pdf', text: 'hello', chars: 5 }]);
  assert.match(r.text, /# Uploaded Reference Documents/);
  assert.match(r.text, /## a\.pdf/);
  assert.match(r.text, /hello/);
  assert.equal(r.truncated, false);
  assert.equal(r.totalChars, r.text.length);
});

test('buildDocumentsContext truncates to maxChars', () => {
  const big = 'x'.repeat(500);
  const r = buildDocumentsContext([{ name: 'b.pdf', text: big, chars: big.length }], { maxChars: 100 });
  assert.equal(r.text.length, 100);
  assert.equal(r.truncated, true);
  assert.ok(r.totalChars > 100);
});

test('combineSystemPromptWithDocuments appends only when context present', () => {
  assert.equal(combineSystemPromptWithDocuments('PROMPT', ''), 'PROMPT');
  assert.equal(combineSystemPromptWithDocuments('PROMPT', 'CTX'), 'PROMPT\n\nCTX');
});

test('addChatbotDocument replaces an entry with the same name', () => {
  const one = addChatbotDocument([], { name: 'a.pdf', text: 'v1', chars: 2 });
  const two = addChatbotDocument(one, { name: 'a.pdf', text: 'v2', chars: 2 });
  assert.equal(two.length, 1);
  assert.equal(two[0].text, 'v2');
});

test('removeChatbotDocument drops the named entry', () => {
  const docs = [{ name: 'a.pdf', text: 'x', chars: 1 }, { name: 'b.pdf', text: 'y', chars: 1 }];
  const r = removeChatbotDocument(docs, 'a.pdf');
  assert.deepEqual(r.map((d) => d.name), ['b.pdf']);
});

test('persist + resolve round-trips through storage', () => {
  withMemoryStorage(() => {
    const docs = [{ name: 'a.pdf', text: 'hello', chars: 5 }];
    assert.deepEqual(persistChatbotDocuments(docs), { ok: true });
    assert.deepEqual(resolveChatbotDocuments(), docs);
  });
});

test('resolveChatbotDocuments returns [] when storage is empty or invalid', () => {
  withMemoryStorage(() => {
    assert.deepEqual(resolveChatbotDocuments(), []);
    globalThis.localStorage.setItem('chatbot.documents', 'not json');
    assert.deepEqual(resolveChatbotDocuments(), []);
  });
});

test('MAX_DOCUMENTS_CHARS is 100000', () => {
  assert.equal(MAX_DOCUMENTS_CHARS, 100000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && node --test "src/lib/chatbotDocuments.test.js"`
Expected: FAIL — `Cannot find module './chatbotDocuments.js'`. Return: `cd ..`.

- [ ] **Step 3: Write the module**

Create `client/src/lib/chatbotDocuments.js`:

```js
export const CHATBOT_DOCUMENTS_STORAGE_KEY = 'chatbot.documents';
export const MAX_DOCUMENTS_CHARS = 100000;

export function resolveChatbotDocuments() {
  try {
    const raw = globalThis.localStorage.getItem(CHATBOT_DOCUMENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((d) => d && typeof d.name === 'string' && typeof d.text === 'string')
      .map((d) => ({
        name: d.name,
        text: d.text,
        chars: typeof d.chars === 'number' ? d.chars : d.text.length,
      }));
  } catch {
    return [];
  }
}

export function persistChatbotDocuments(docs) {
  try {
    globalThis.localStorage.setItem(
      CHATBOT_DOCUMENTS_STORAGE_KEY,
      JSON.stringify(Array.isArray(docs) ? docs : []),
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function clearChatbotDocuments() {
  try {
    globalThis.localStorage.removeItem(CHATBOT_DOCUMENTS_STORAGE_KEY);
  } catch {
    // best-effort
  }
}

export function addChatbotDocument(docs, doc) {
  const list = Array.isArray(docs) ? docs : [];
  const without = list.filter((d) => d.name !== doc.name);
  return [...without, { name: doc.name, text: doc.text, chars: doc.chars }];
}

export function removeChatbotDocument(docs, name) {
  const list = Array.isArray(docs) ? docs : [];
  return list.filter((d) => d.name !== name);
}

export function buildDocumentsContext(docs, { maxChars = MAX_DOCUMENTS_CHARS } = {}) {
  const list = Array.isArray(docs) ? docs.filter((d) => d && d.text) : [];
  if (list.length === 0) return { text: '', truncated: false, totalChars: 0 };
  const header = '# Uploaded Reference Documents\n'
    + 'Treat the following as additional approved reference material. Use it the '
    + 'same way as the approved material above. Do not invent details beyond it.';
  const body = list.map((d) => `## ${d.name}\n${d.text}`).join('\n\n');
  const full = `${header}\n\n${body}`;
  const totalChars = full.length;
  if (totalChars <= maxChars) return { text: full, truncated: false, totalChars };
  return { text: full.slice(0, maxChars), truncated: true, totalChars };
}

export function combineSystemPromptWithDocuments(prompt, docsContext) {
  const base = typeof prompt === 'string' ? prompt : '';
  const ctx = typeof docsContext === 'string' ? docsContext : '';
  if (!ctx) return base;
  return `${base}\n\n${ctx}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && node --test "src/lib/chatbotDocuments.test.js"`
Expected: PASS (all tests). Then run the full suite: `node --test "src/**/*.test.js"` — expected all pass. Return: `cd ..`.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/chatbotDocuments.js client/src/lib/chatbotDocuments.test.js
git commit -m "feat(client): chatbot document context helpers (build/combine/persist)"
```

---

### Task 2: PDF text extraction module

**Files:**
- Modify: `client/package.json` (add `pdfjs-dist` dependency)
- Create: `client/src/lib/chatbotPdf.js`

**Interfaces:**
- Produces: `extractPdfText(file) -> Promise<{name: string, text: string, chars: number}>`. Throws on unreadable/corrupt input; resolves with `text: ''` when the PDF has no text layer.

- [ ] **Step 1: Install pdfjs-dist**

Run:
```bash
cd client && npm install pdfjs-dist@4
```
Expected: `pdfjs-dist` added to `dependencies` in `client/package.json` (a 4.x version). Return: `cd ..`. (Leave `package-lock.json` changes from this install staged with the commit in Step 4 — that is the legitimate lock update for the new dependency, distinct from the pre-existing stray change.)

- [ ] **Step 2: Write the extraction module**

Create `client/src/lib/chatbotPdf.js`:

```js
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Extract the text layer of a PDF File in the browser. Returns empty text for
// PDFs with no text layer (e.g. scanned images); throws on unreadable input.
export async function extractPdfText(file) {
  const name = file?.name || 'document.pdf';
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const parts = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(' ').trim();
    if (pageText) parts.push(pageText);
  }
  const text = parts.join('\n\n').trim();
  return { name, text, chars: text.length };
}
```

- [ ] **Step 3: Verify it bundles (build gate)**

Run:
```bash
cd client && npm run build:chatbot
```
Expected: build succeeds (the `pdfjs-dist/build/pdf.worker.min.mjs?url` import resolves and the worker asset is emitted). A "chunks larger than 500 kB" warning is pre-existing and acceptable. Return: `cd ..`.

(There is no unit test for this module: pdfjs binary parsing + the Vite-only `?url` import cannot run under `node:test`. The build gate above plus the end-to-end kiosk check in Task 3 are its verification.)

- [ ] **Step 4: Commit**

```bash
git add client/package.json client/package-lock.json client/src/lib/chatbotPdf.js
git commit -m "feat(client): PDF text extraction via pdfjs-dist"
```

---

### Task 3: Kiosk Reference Documents panel + prompt wiring

**Files:**
- Modify: `client/src/pages/LivePage.jsx`

**Interfaces:**
- Consumes from Task 1: `resolveChatbotDocuments`, `persistChatbotDocuments`, `addChatbotDocument`, `removeChatbotDocument`, `buildDocumentsContext`, `combineSystemPromptWithDocuments`, `MAX_DOCUMENTS_CHARS`.
- Consumes from Task 2: `extractPdfText`.

- [ ] **Step 1: Add imports**

In `client/src/pages/LivePage.jsx`, immediately after the existing
`} from '@/lib/chatbotSystemPrompt';` line (around line 90), add:

```js
import {
  MAX_DOCUMENTS_CHARS,
  resolveChatbotDocuments,
  persistChatbotDocuments,
  addChatbotDocument,
  removeChatbotDocument,
  buildDocumentsContext,
  combineSystemPromptWithDocuments,
} from '@/lib/chatbotDocuments';
import { extractPdfText } from '@/lib/chatbotPdf';
```

- [ ] **Step 2: Add state**

Immediately after the existing `chatbotSystemPrompt` state line (around line 315):

```js
  const [chatbotDocuments, setChatbotDocuments] = useState(() => (kiosk ? resolveChatbotDocuments() : []));
  const [chatbotDocError, setChatbotDocError] = useState('');
  const chatbotCombinedSystemPrompt = useMemo(
    () => combineSystemPromptWithDocuments(
      chatbotSystemPrompt,
      buildDocumentsContext(chatbotDocuments).text,
    ),
    [chatbotSystemPrompt, chatbotDocuments],
  );
```

- [ ] **Step 3: Wire the combined prompt into useLiveSpeech**

Change the `systemPrompt` line (around line 579) from:

```js
    systemPrompt: kiosk ? chatbotSystemPrompt : '',
```
to:
```js
    systemPrompt: kiosk ? chatbotCombinedSystemPrompt : '',
```

- [ ] **Step 4: Add the handlers**

Immediately after the existing `handleResetChatbotSystemPrompt` function (around line 2942-2946), add:

```js
  async function handleAddChatbotDocuments(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setChatbotDocError('');
    let next = chatbotDocuments;
    for (const file of files) {
      if (file.type !== 'application/pdf') {
        setChatbotDocError(`${file.name}: not a PDF.`);
        continue;
      }
      try {
        const doc = await extractPdfText(file);
        if (!doc.text) {
          setChatbotDocError(`${file.name}: no extractable text (scanned image?).`);
          continue;
        }
        next = addChatbotDocument(next, doc);
      } catch {
        setChatbotDocError(`${file.name}: could not read PDF.`);
      }
    }
    setChatbotDocuments(next);
    const { ok } = persistChatbotDocuments(next);
    if (!ok) setChatbotDocError('Documents too large to save; kept for this session only.');
  }

  function handleRemoveChatbotDocument(name) {
    const next = removeChatbotDocument(chatbotDocuments, name);
    setChatbotDocuments(next);
    persistChatbotDocuments(next);
  }
```

- [ ] **Step 5: Add the Reference documents UI**

In the kiosk `<aside>`, immediately after the `<Textarea ... />` element (it
closes with `/>` around line 3696) and before the footer `<p className="border-t ...">`
(around line 3697), insert:

```jsx
          <div className="border-t border-slate-100 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                Reference documents
              </span>
              <label
                className={cn(
                  'cursor-pointer text-xs font-medium text-primary hover:text-primary/80',
                  isConversationActive && 'pointer-events-none opacity-40',
                )}
              >
                + Add PDF
                <input
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="hidden"
                  disabled={isConversationActive}
                  onChange={(e) => { handleAddChatbotDocuments(e.target.files); e.target.value = ''; }}
                />
              </label>
            </div>
            {chatbotDocuments.length > 0 && (
              <ul className="mt-2 space-y-1">
                {chatbotDocuments.map((doc) => (
                  <li key={doc.name} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                    <span className="truncate">{doc.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-slate-400">{doc.chars.toLocaleString()} chars</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveChatbotDocument(doc.name)}
                        disabled={isConversationActive}
                        className="text-slate-400 hover:text-red-500 disabled:opacity-40"
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {buildDocumentsContext(chatbotDocuments).totalChars > 0 && (
              <p
                className={cn(
                  'mt-2 text-[11px]',
                  buildDocumentsContext(chatbotDocuments).totalChars > MAX_DOCUMENTS_CHARS
                    ? 'text-amber-600'
                    : 'text-slate-400',
                )}
              >
                {buildDocumentsContext(chatbotDocuments).totalChars.toLocaleString()}
                {' / '}
                {MAX_DOCUMENTS_CHARS.toLocaleString()} chars
                {buildDocumentsContext(chatbotDocuments).totalChars > MAX_DOCUMENTS_CHARS ? ' — will be truncated.' : ''}
              </p>
            )}
            {chatbotDocError && (
              <p className="mt-2 text-[11px] text-red-500">{chatbotDocError}</p>
            )}
          </div>
```

- [ ] **Step 6: Verify the build**

Run:
```bash
cd client && npm run build:chatbot
```
Expected: build succeeds. Return: `cd ..`.

- [ ] **Step 7: Manual kiosk verification**

Run `cd client && npm run dev:chatbot`, open `http://localhost:5175`, and confirm:
1. The "Reference documents" area appears below the system-prompt textarea (kiosk only).
2. "+ Add PDF" accepts a text-based PDF; it appears in the list with a char count; the total indicator updates.
3. A scanned-image PDF shows "no extractable text (scanned image?)" and is not added.
4. Removing a doc (✕) updates the list and total.
5. Refreshing the page keeps the uploaded docs (localStorage persistence).
6. Starting a conversation, the assistant can answer from the uploaded document's content (proves the combined prompt reaches the model).
7. The area is disabled while a conversation is active.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/LivePage.jsx
git commit -m "feat(client): kiosk Reference Documents panel feeding the system prompt"
```

---

## Self-Review

**Spec coverage:**
- Client-side pdfjs extraction: Task 2. ✓
- Append to system prompt, combined string via session.init: Task 1 (`combineSystemPromptWithDocuments`) + Task 3 Step 3 wiring. ✓
- Persist to localStorage (`chatbot.documents`): Task 1 (`persistChatbotDocuments`/`resolveChatbotDocuments`) + Task 3 state/handlers. ✓
- 100k cap + truncation + warning: Task 1 (`buildDocumentsContext`) + Task 3 Step 5 indicator. ✓
- UI in kiosk Assistant-instructions panel, locked during chat: Task 3 Step 5. ✓
- Error handling (non-PDF, no text layer, quota): Task 3 Step 4 handler. ✓
- Kiosk-only: state init guards on `kiosk`; UI inside the `{kiosk && (...)}` aside; wiring `kiosk ? ... : ''`. ✓
- Module split (chatbotDocuments vs chatbotPdf): Architecture note — keeps node:test off the Vite-only import. ✓
- Out of scope (retrieval, OCR, non-PDF, backend): nothing in the plan adds these. ✓

**Placeholder scan:** none. The one helper test uses a small local mock-storage helper; all code blocks are complete.

**Type consistency:** `{name,text,chars}` doc shape is consistent across `extractPdfText`, `addChatbotDocument`, `buildDocumentsContext`, and the UI (`doc.chars`). `buildDocumentsContext` returns `{text,truncated,totalChars}` — consumed as `.text` (wiring) and `.totalChars` (indicator). `combineSystemPromptWithDocuments(prompt, docsContext)` takes the `.text` string. ✓
