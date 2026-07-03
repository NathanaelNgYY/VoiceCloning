# Shared Chatbot System Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chatbot system prompt a single shared value persisted on the `live-gateway` (file-backed) so one edit applies to every chatbot visitor, replacing per-browser `localStorage`.

**Architecture:** Add a passive file-backed key-value store + two HTTP routes (`GET`/`PUT /api/live/chat/system-prompt`) to the `live-gateway`. The chatbot client (kiosk build only) loads the shared prompt on mount and saves edits back via those routes. The per-connection prompt that drives OpenAI is still sent via the existing `session.init` handshake — the gateway's WebSocket connect path is **not** changed to read the store, which preserves per-CloudFront isolation.

**Tech Stack:** Node.js + Express (ESM) on the gateway; React 18 + Vite on the client. Tests: `node --test` (both gateway and client — client tests run under plain Node, so no `@/` alias or `import.meta.env` in tested modules).

## Global Constraints

- All packages use ES modules (`import`/`export`).
- **Isolation invariant (hard):** the gateway store is passive. `live-gateway/src/routes/liveChat.js` (the WS connect path) MUST NOT import or read the store. The per-connection prompt comes only from the client's `session.init`. An empty `session.init` keeps the server default `OPENAI_REALTIME_SYSTEM_PROMPT`.
- All client GET/PUT/load/save logic is gated behind `kiosk` (`APP_MODE_CONFIG.kiosk`). The non-kiosk build compiles none of it.
- Client tested modules must not import `@/lib/runtimeConfig` (it throws under `node --test` because it reads `import.meta.env.VITE_API_BASE_URL` unguarded). Inject the resolved endpoint as a function argument instead.
- Gateway store path env var: `SYSTEM_PROMPT_STORE_PATH`, default `./data/system-prompt.json`.
- HTTP path constant (shared value): `/api/live/chat/system-prompt`.

---

### Task 1: Gateway file-backed system-prompt store

**Files:**
- Modify: `live-gateway/src/config.js` (add `SYSTEM_PROMPT_STORE_PATH` export)
- Create: `live-gateway/src/services/systemPromptStore.js`
- Test: `live-gateway/src/services/systemPromptStore.test.js`

**Interfaces:**
- Consumes: `SYSTEM_PROMPT_STORE_PATH` from `../config.js`.
- Produces:
  - `getSystemPrompt(): string | null`
  - `setSystemPrompt(value: string): string` (throws `TypeError` if `value` is not a string; writes the file)
  - `loadSystemPrompt(): string | null` (reads the file into memory)
  - `__setStorePathForTests(path: string): void` (test-only; repoints the active file path and clears cache)

- [ ] **Step 1: Add the config export**

In `live-gateway/src/config.js`, add after the `PORT` export (line 48):

```javascript
export const SYSTEM_PROMPT_STORE_PATH = process.env.SYSTEM_PROMPT_STORE_PATH
  || './data/system-prompt.json';
```

- [ ] **Step 2: Write the failing test**

Create `live-gateway/src/services/systemPromptStore.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getSystemPrompt,
  setSystemPrompt,
  loadSystemPrompt,
  __setStorePathForTests,
} from './systemPromptStore.js';

function tmpStorePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sysprompt-')), 'store.json');
}

test('unset store returns null', () => {
  __setStorePathForTests(tmpStorePath());
  assert.equal(getSystemPrompt(), null);
});

test('set then get returns the stored value', () => {
  __setStorePathForTests(tmpStorePath());
  assert.equal(setSystemPrompt('Shared prompt'), 'Shared prompt');
  assert.equal(getSystemPrompt(), 'Shared prompt');
});

test('set persists to the file as JSON', () => {
  const p = tmpStorePath();
  __setStorePathForTests(p);
  setSystemPrompt('Persisted');
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf-8')), { systemPrompt: 'Persisted' });
});

test('load restores from an existing file', () => {
  const p = tmpStorePath();
  fs.writeFileSync(p, JSON.stringify({ systemPrompt: 'From disk' }), 'utf-8');
  __setStorePathForTests(p);
  assert.equal(loadSystemPrompt(), 'From disk');
  assert.equal(getSystemPrompt(), 'From disk');
});

test('missing or corrupt file loads as null without throwing', () => {
  __setStorePathForTests(tmpStorePath()); // file does not exist yet
  assert.equal(loadSystemPrompt(), null);

  const p = tmpStorePath();
  fs.writeFileSync(p, 'not json', 'utf-8');
  __setStorePathForTests(p);
  assert.equal(loadSystemPrompt(), null);
});

test('setSystemPrompt rejects a non-string value', () => {
  __setStorePathForTests(tmpStorePath());
  assert.throws(() => setSystemPrompt(42), TypeError);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd live-gateway && node --test src/services/systemPromptStore.test.js`
Expected: FAIL — cannot find module `./systemPromptStore.js`.

- [ ] **Step 4: Implement the store**

Create `live-gateway/src/services/systemPromptStore.js`:

```javascript
import fs from 'fs';
import path from 'path';
import { SYSTEM_PROMPT_STORE_PATH } from '../config.js';

let activePath = SYSTEM_PROMPT_STORE_PATH;
let current = null;
let loaded = false;

export function loadSystemPrompt() {
  try {
    const parsed = JSON.parse(fs.readFileSync(activePath, 'utf-8'));
    current = typeof parsed?.systemPrompt === 'string' ? parsed.systemPrompt : null;
  } catch {
    // Missing or unreadable/corrupt file → treat as unset.
    current = null;
  }
  loaded = true;
  return current;
}

export function getSystemPrompt() {
  if (!loaded) {
    loadSystemPrompt();
  }
  return current;
}

export function setSystemPrompt(value) {
  if (typeof value !== 'string') {
    throw new TypeError('systemPrompt must be a string');
  }
  fs.mkdirSync(path.dirname(activePath), { recursive: true });
  fs.writeFileSync(activePath, JSON.stringify({ systemPrompt: value }), 'utf-8');
  current = value;
  loaded = true;
  return current;
}

export function __setStorePathForTests(nextPath) {
  activePath = nextPath;
  current = null;
  loaded = false;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd live-gateway && node --test src/services/systemPromptStore.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add live-gateway/src/config.js live-gateway/src/services/systemPromptStore.js live-gateway/src/services/systemPromptStore.test.js
git commit -m "feat(live-gateway): add file-backed shared system-prompt store"
```

---

### Task 2: Gateway HTTP routes for the shared prompt

**Files:**
- Create: `live-gateway/src/routes/systemPrompt.js`
- Modify: `live-gateway/src/index.js` (mount the router, load store on startup)
- Test: `live-gateway/src/routes/systemPrompt.test.js`
- Modify: `live-gateway/.env.livegateway.deployment` (document the new env var)

**Interfaces:**
- Consumes: `getSystemPrompt`, `setSystemPrompt` from `../services/systemPromptStore.js`.
- Produces:
  - `SYSTEM_PROMPT_PATH = '/api/live/chat/system-prompt'`
  - `handleGetSystemPrompt(req, res)` → responds `{ systemPrompt: string | null }`
  - `handlePutSystemPrompt(req, res)` → 400 on non-string body; 200 `{ systemPrompt }` on success; 500 on write failure
  - `createSystemPromptRouter(): express.Router`

- [ ] **Step 1: Write the failing test**

Create `live-gateway/src/routes/systemPrompt.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { __setStorePathForTests } from '../services/systemPromptStore.js';
import { handleGetSystemPrompt, handlePutSystemPrompt } from './systemPrompt.js';

function tmpStorePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sysprompt-route-')), 'store.json');
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('GET returns null when the store is unset', () => {
  __setStorePathForTests(tmpStorePath());
  const res = mockRes();
  handleGetSystemPrompt({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { systemPrompt: null });
});

test('PUT persists a string and GET reads it back', () => {
  __setStorePathForTests(tmpStorePath());
  const putRes = mockRes();
  handlePutSystemPrompt({ body: { systemPrompt: 'Hello shared' } }, putRes);
  assert.equal(putRes.statusCode, 200);
  assert.deepEqual(putRes.body, { systemPrompt: 'Hello shared' });

  const getRes = mockRes();
  handleGetSystemPrompt({}, getRes);
  assert.deepEqual(getRes.body, { systemPrompt: 'Hello shared' });
});

test('PUT rejects a non-string body with 400', () => {
  __setStorePathForTests(tmpStorePath());
  const res = mockRes();
  handlePutSystemPrompt({ body: { systemPrompt: 123 } }, res);
  assert.equal(res.statusCode, 400);
});

test('PUT rejects a missing body with 400', () => {
  __setStorePathForTests(tmpStorePath());
  const res = mockRes();
  handlePutSystemPrompt({}, res);
  assert.equal(res.statusCode, 400);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd live-gateway && node --test src/routes/systemPrompt.test.js`
Expected: FAIL — cannot find module `./systemPrompt.js`.

- [ ] **Step 3: Implement the routes**

Create `live-gateway/src/routes/systemPrompt.js`:

```javascript
import { Router } from 'express';
import { getSystemPrompt, setSystemPrompt } from '../services/systemPromptStore.js';

export const SYSTEM_PROMPT_PATH = '/api/live/chat/system-prompt';

export function handleGetSystemPrompt(_req, res) {
  res.json({ systemPrompt: getSystemPrompt() });
}

export function handlePutSystemPrompt(req, res) {
  const value = req?.body?.systemPrompt;
  if (typeof value !== 'string') {
    res.status(400).json({ error: 'systemPrompt must be a string' });
    return;
  }
  try {
    const saved = setSystemPrompt(value);
    res.json({ systemPrompt: saved });
  } catch {
    res.status(500).json({ error: 'Failed to persist system prompt' });
  }
}

export function createSystemPromptRouter() {
  const router = Router();
  router.get(SYSTEM_PROMPT_PATH, handleGetSystemPrompt);
  router.put(SYSTEM_PROMPT_PATH, handlePutSystemPrompt);
  return router;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd live-gateway && node --test src/routes/systemPrompt.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Mount the router and load the store on startup**

In `live-gateway/src/index.js`, update the import block (lines 4-5):

```javascript
import { CORS_ORIGIN, PORT } from './config.js';
import { attachLiveChatSocket } from './routes/liveChat.js';
import { createSystemPromptRouter } from './routes/systemPrompt.js';
import { loadSystemPrompt } from './services/systemPromptStore.js';
```

After the `/healthz` route (after line 18), add:

```javascript
loadSystemPrompt();
app.use(createSystemPromptRouter());
```

- [ ] **Step 6: Document the env var**

In `live-gateway/.env.livegateway.deployment`, add a line (adjust to the file's existing formatting):

```
# Path to the JSON file holding the shared chatbot system prompt (file-backed, survives restarts).
SYSTEM_PROMPT_STORE_PATH=./data/system-prompt.json
```

- [ ] **Step 7: Run the full gateway suite and start the server once**

Run: `cd live-gateway && node --test "src/**/*.test.js"`
Expected: PASS (all suites, including the new store + route tests).

Run: `cd live-gateway && node -e "import('./src/index.js').then(()=>{console.log('boot ok');process.exit(0)})"`
Expected: prints `[live-gateway] Running on ...` and `boot ok` with no crash (confirms the router mounts and the store loads).

- [ ] **Step 8: Commit**

```bash
git add live-gateway/src/routes/systemPrompt.js live-gateway/src/routes/systemPrompt.test.js live-gateway/src/index.js live-gateway/.env.livegateway.deployment
git commit -m "feat(live-gateway): serve shared chatbot system prompt over HTTP"
```

---

### Task 3: Isolation regression test (store never leaks into the WS connect path)

**Files:**
- Modify: `live-gateway/src/routes/liveChat.test.js` (add one guard test)

**Interfaces:**
- Consumes: `parseLiveChatInit`, `applyLiveChatInitToBridge` from `./liveChat.js`; `setSystemPrompt`, `__setStorePathForTests` from `../services/systemPromptStore.js`.
- Produces: nothing (test-only).

- [ ] **Step 1: Add the guard test**

At the end of `live-gateway/src/routes/liveChat.test.js`, add these imports to the existing import block at the top of the file:

```javascript
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setSystemPrompt, __setStorePathForTests } from '../services/systemPromptStore.js';
```

Then append this test:

```javascript
test('empty session.init keeps the bridge default even when the shared store is set', () => {
  // Populate the shared store with a value that must NOT influence the connect path.
  __setStorePathForTests(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iso-')), 'store.json'));
  setSystemPrompt('SHARED VALUE FROM STORE');

  // A non-chatbot client sends an empty prompt; the bridge keeps its server default.
  const bridge = { systemPrompt: 'SERVER_DEFAULT' };
  const init = parseLiveChatInit(JSON.stringify({ type: 'session.init', systemPrompt: '' }));
  applyLiveChatInitToBridge(bridge, init);

  assert.equal(bridge.systemPrompt, 'SERVER_DEFAULT'); // not the store value
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd live-gateway && node --test src/routes/liveChat.test.js`
Expected: PASS (existing tests + the new guard). The guard passes precisely because `liveChat.js` never imports the store; if a future change wires the store into the connect path, this test fails.

- [ ] **Step 3: Commit**

```bash
git add live-gateway/src/routes/liveChat.test.js
git commit -m "test(live-gateway): guard chatbot store isolation from WS connect path"
```

---

### Task 4: Client gateway HTTP path resolver

**Files:**
- Modify: `client/src/lib/runtimeConfig.js` (add `resolveLiveGatewayHttpPath`)

**Interfaces:**
- Consumes: existing module-level `liveGatewayOrigin`, `apiOrigin`.
- Produces: `resolveLiveGatewayHttpPath(pathname: string): string` — absolute `http(s)` URL against the live-gateway origin, mirroring `resolveWsPath`'s base resolution but keeping the http scheme.

> **Note (no unit test):** `runtimeConfig.js` is browser-only and reads `import.meta.env.VITE_API_BASE_URL` unguarded at import, so it is not importable under `node --test` (the existing module has no test for the same reason). This helper is a direct structural mirror of the already-proven `resolveWsPath`; it is verified via the LivePage manual check in Task 6.

- [ ] **Step 1: Add the resolver**

In `client/src/lib/runtimeConfig.js`, add after `resolveWsPath` (after line 33):

```javascript
export function resolveLiveGatewayHttpPath(pathname) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const base = liveGatewayOrigin
    || apiOrigin
    || (typeof window !== 'undefined' ? window.location.origin : '');
  return new URL(normalizedPath, base || 'http://localhost').toString();
}
```

- [ ] **Step 2: Verify it parses (syntax check)**

Run: `cd client && node --check src/lib/runtimeConfig.js`
Expected: no output, exit 0 (file is syntactically valid ESM).

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/runtimeConfig.js
git commit -m "feat(client): add resolveLiveGatewayHttpPath for gateway HTTP calls"
```

---

### Task 5: Client prompt module — server-backed fetch/save

**Files:**
- Modify: `client/src/lib/chatbotSystemPrompt.js` (replace localStorage API with fetch/save)
- Test: `client/src/lib/chatbotSystemPrompt.test.js` (rewrite for the new API)

**Interfaces:**
- Consumes: none (endpoint is injected by the caller — see Global Constraints).
- Produces:
  - `DEFAULT_CHATBOT_SYSTEM_PROMPT` (unchanged), `getDefaultChatbotSystemPrompt()` (unchanged)
  - `CHATBOT_SYSTEM_PROMPT_PATH = '/api/live/chat/system-prompt'`
  - `fetchSharedChatbotSystemPrompt(endpoint: string): Promise<string>` — server value if a non-empty string, else the baked default; never throws (falls back to default on any error/non-ok).
  - `saveSharedChatbotSystemPrompt(endpoint: string, value): Promise<string>` — PUTs `{ systemPrompt }`, returns the saved string; **throws** on non-ok/network failure.
- Removed: `CHATBOT_SYSTEM_PROMPT_STORAGE_KEY`, `resolveChatbotSystemPrompt`, `persistChatbotSystemPrompt`, `clearChatbotSystemPrompt`.

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `client/src/lib/chatbotSystemPrompt.test.js` with:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHATBOT_SYSTEM_PROMPT,
  CHATBOT_SYSTEM_PROMPT_PATH,
  getDefaultChatbotSystemPrompt,
  fetchSharedChatbotSystemPrompt,
  saveSharedChatbotSystemPrompt,
} from './chatbotSystemPrompt.js';

const ENDPOINT = 'http://gateway.test' + CHATBOT_SYSTEM_PROMPT_PATH;

function mockFetch(impl) {
  globalThis.fetch = impl;
}

test('default prompt mentions the GI bleeding role', () => {
  assert.ok(DEFAULT_CHATBOT_SYSTEM_PROMPT.includes('GI bleeding'));
  assert.equal(getDefaultChatbotSystemPrompt(), DEFAULT_CHATBOT_SYSTEM_PROMPT);
});

test('fetch returns the stored server value', async () => {
  mockFetch(async () => ({ ok: true, json: async () => ({ systemPrompt: 'Shared prompt' }) }));
  assert.equal(await fetchSharedChatbotSystemPrompt(ENDPOINT), 'Shared prompt');
});

test('fetch falls back to the default when the server value is null', async () => {
  mockFetch(async () => ({ ok: true, json: async () => ({ systemPrompt: null }) }));
  assert.equal(await fetchSharedChatbotSystemPrompt(ENDPOINT), getDefaultChatbotSystemPrompt());
});

test('fetch falls back to the default on a non-ok response', async () => {
  mockFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.equal(await fetchSharedChatbotSystemPrompt(ENDPOINT), getDefaultChatbotSystemPrompt());
});

test('fetch falls back to the default on a network error', async () => {
  mockFetch(async () => { throw new Error('offline'); });
  assert.equal(await fetchSharedChatbotSystemPrompt(ENDPOINT), getDefaultChatbotSystemPrompt());
});

test('save PUTs the value and returns the saved string', async () => {
  let captured;
  mockFetch(async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => ({ systemPrompt: 'New prompt' }) };
  });
  const result = await saveSharedChatbotSystemPrompt(ENDPOINT, 'New prompt');
  assert.equal(result, 'New prompt');
  assert.equal(captured.url, ENDPOINT);
  assert.equal(captured.options.method, 'PUT');
  assert.deepEqual(JSON.parse(captured.options.body), { systemPrompt: 'New prompt' });
});

test('save throws on a non-ok response', async () => {
  mockFetch(async () => ({ ok: false, status: 500 }));
  await assert.rejects(() => saveSharedChatbotSystemPrompt(ENDPOINT, 'x'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && node --test src/lib/chatbotSystemPrompt.test.js`
Expected: FAIL — `fetchSharedChatbotSystemPrompt` / `saveSharedChatbotSystemPrompt` / `CHATBOT_SYSTEM_PROMPT_PATH` are not exported.

- [ ] **Step 3: Rewrite the module**

In `client/src/lib/chatbotSystemPrompt.js`, keep `DEFAULT_CHATBOT_SYSTEM_PROMPT` (lines 3-49) and `getDefaultChatbotSystemPrompt` (lines 51-54) exactly as they are. Replace line 1 (`export const CHATBOT_SYSTEM_PROMPT_STORAGE_KEY = ...`) and the localStorage functions (lines 56-82) so the file reads:

```javascript
export const CHATBOT_SYSTEM_PROMPT_PATH = '/api/live/chat/system-prompt';

export const DEFAULT_CHATBOT_SYSTEM_PROMPT = `# Role & Objective
... (UNCHANGED — leave the existing multi-line default exactly as-is) ...`;

export function getDefaultChatbotSystemPrompt() {
  const envValue = (import.meta.env?.VITE_CHATBOT_SYSTEM_PROMPT || '').trim();
  return envValue || DEFAULT_CHATBOT_SYSTEM_PROMPT;
}

export async function fetchSharedChatbotSystemPrompt(endpoint) {
  try {
    const res = await fetch(endpoint);
    if (!res.ok) {
      return getDefaultChatbotSystemPrompt();
    }
    const data = await res.json();
    const value = data?.systemPrompt;
    return typeof value === 'string' && value.length > 0
      ? value
      : getDefaultChatbotSystemPrompt();
  } catch {
    // Gateway unreachable / bad JSON → use the baked-in default (session-only).
    return getDefaultChatbotSystemPrompt();
  }
}

export async function saveSharedChatbotSystemPrompt(endpoint, value) {
  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt: String(value ?? '') }),
  });
  if (!res.ok) {
    throw new Error(`Failed to save system prompt (${res.status})`);
  }
  const data = await res.json();
  return typeof data?.systemPrompt === 'string' ? data.systemPrompt : String(value ?? '');
}
```

(The `CHATBOT_SYSTEM_PROMPT_PATH` export must appear once, at the top; keep the existing `DEFAULT_CHATBOT_SYSTEM_PROMPT` body verbatim.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && node --test src/lib/chatbotSystemPrompt.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/chatbotSystemPrompt.js client/src/lib/chatbotSystemPrompt.test.js
git commit -m "feat(client): back chatbot system prompt with the shared gateway store"
```

---

### Task 6: Wire LivePage to the shared prompt (kiosk only)

**Files:**
- Modify: `client/src/pages/LivePage.jsx`

**Interfaces:**
- Consumes: `resolveLiveGatewayHttpPath` (Task 4); `CHATBOT_SYSTEM_PROMPT_PATH`, `getDefaultChatbotSystemPrompt`, `fetchSharedChatbotSystemPrompt`, `saveSharedChatbotSystemPrompt` (Task 5).
- Produces: nothing (page wiring).

> **No unit test:** `LivePage.jsx` is a large component with no existing test harness; it is verified end-to-end in Step 7 (manual). This task changes imports, state init, a mount effect, three handlers, the status UI, and the textarea `onBlur` only.

- [ ] **Step 1: Update imports**

In `client/src/pages/LivePage.jsx`, change the runtimeConfig import (line 70) to:

```javascript
import { getStorageMode, resolveLiveGatewayHttpPath } from '@/lib/runtimeConfig';
```

Replace the chatbotSystemPrompt import block (lines 85-90) with:

```javascript
import {
  CHATBOT_SYSTEM_PROMPT_PATH,
  getDefaultChatbotSystemPrompt,
  fetchSharedChatbotSystemPrompt,
  saveSharedChatbotSystemPrompt,
} from '@/lib/chatbotSystemPrompt';
```

- [ ] **Step 2: Update state init and add the endpoint + status state**

Replace line 295:

```javascript
  const [chatbotSystemPrompt, setChatbotSystemPrompt] = useState(() => (kiosk ? getDefaultChatbotSystemPrompt() : ''));
```

Immediately after line 295, add:

```javascript
  const [chatbotPromptStatus, setChatbotPromptStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const chatbotSystemPromptEndpoint = useMemo(
    () => resolveLiveGatewayHttpPath(CHATBOT_SYSTEM_PROMPT_PATH),
    [],
  );
```

- [ ] **Step 3: Add a mount effect that loads the shared prompt (kiosk only)**

Add this effect near the other effects in the component body (anywhere after the state declarations; place it just after the `chatbotCombinedSystemPrompt` memo, i.e. after line 304):

```javascript
  useEffect(() => {
    if (!kiosk) return undefined;
    let cancelled = false;
    fetchSharedChatbotSystemPrompt(chatbotSystemPromptEndpoint).then((value) => {
      if (!cancelled) setChatbotSystemPrompt(value);
    });
    return () => { cancelled = true; };
  }, [kiosk, chatbotSystemPromptEndpoint]);
```

- [ ] **Step 4: Replace the prompt handlers**

Replace the existing handlers (lines 3014-3023: `handleChatbotSystemPromptChange` and `handleResetChatbotSystemPrompt`) with:

```javascript
  function handleChatbotSystemPromptChange(value) {
    setChatbotSystemPrompt(value);
    setChatbotPromptStatus('idle');
  }

  async function saveChatbotSystemPrompt(value) {
    setChatbotPromptStatus('saving');
    try {
      const saved = await saveSharedChatbotSystemPrompt(chatbotSystemPromptEndpoint, value);
      setChatbotSystemPrompt(saved);
      setChatbotPromptStatus('saved');
    } catch {
      setChatbotPromptStatus('error');
    }
  }

  function handleChatbotSystemPromptBlur() {
    saveChatbotSystemPrompt(chatbotSystemPrompt);
  }

  function handleResetChatbotSystemPrompt() {
    const next = getDefaultChatbotSystemPrompt();
    setChatbotSystemPrompt(next);
    saveChatbotSystemPrompt(next);
  }
```

- [ ] **Step 5: Add the save status indicator and textarea onBlur**

In the instructions panel header's right-hand cluster (the `<div className="flex items-center gap-3">` at line 3850), add a status span as the first child, immediately before the "Reset to default" button (line 3851):

```jsx
              {chatbotPromptStatus === 'saving' && (
                <span className="text-[11px] text-slate-400">Saving…</span>
              )}
              {chatbotPromptStatus === 'saved' && (
                <span className="text-[11px] text-emerald-500">Saved</span>
              )}
              {chatbotPromptStatus === 'error' && (
                <span className="text-[11px] text-red-500">Save failed</span>
              )}
```

Then add `onBlur` to the `<Textarea>` (line 3869-3875), right after the `onChange` prop:

```jsx
            onBlur={handleChatbotSystemPromptBlur}
```

- [ ] **Step 6: Build the chatbot bundle to confirm it compiles**

Run: `cd client && npm run build:chatbot`
Expected: Vite build succeeds, no unresolved-import or reference errors, `dist-chatbot` written.

- [ ] **Step 7: Manual end-to-end verification**

Terminal A: `cd live-gateway && rm -f ./data/system-prompt.json && npm run dev`
Terminal B: `cd client && npm run dev:chatbot` (serves the kiosk build on port 5175).

1. Open `http://localhost:5175`. The instructions panel shows the baked-in GI-bleeding default (gateway store is unset → client fell back to default). Confirm the gateway did not error.
2. Edit the prompt text, then click outside the textarea (blur). The header shows "Saving…" then "Saved". Confirm `live-gateway/data/system-prompt.json` now exists and contains your edit.
3. Reload the page. The edited prompt loads from the server (not the default) — this is the shared value.
4. Open the same URL in a second browser/incognito window. It shows the same edited prompt (shared across users, not per-browser).
5. Click "Reset to default": the textarea reverts to the baked default and "Saved" appears; the JSON file now holds the default. The second window shows the default after reload.
6. **Isolation check:** run the main Live app build (`cd client && npm run dev:live-fast`, port 5174) against the same gateway. Confirm no instructions panel renders and no request to `/api/live/chat/system-prompt` is made (Network tab), i.e. the main app is unaffected by the shared store.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/LivePage.jsx
git commit -m "feat(client): load and save the shared chatbot prompt from the gateway"
```

---

## Self-review notes

- **Spec coverage:** store (Task 1) ↔ spec §1; config env (Task 1/2) ↔ §2; routes (Task 2) ↔ §3; isolation invariant + regression test (Task 3, Global Constraints) ↔ "Per-distribution isolation" + Testing; runtime path resolver (Task 4) ↔ §4; client module fetch/save + resolution order + error fallback (Task 5) ↔ §5 + Error handling; LivePage load-on-mount, manual save, reset-for-everyone, status UI (Task 6) ↔ §6 + Decisions. Data-flow and "main app unaffected" verified in Task 6 Step 7.6 and Task 3.
- **Deviation from spec §4/§5:** the spec described the client module calling `resolveLiveGatewayHttpPath` internally. Implemented via endpoint injection (caller passes the resolved endpoint) so the module stays `node --test`-safe. Same runtime behavior; documented in Global Constraints.
- **Type consistency:** `fetchSharedChatbotSystemPrompt(endpoint)` and `saveSharedChatbotSystemPrompt(endpoint, value)` signatures match across Task 5 (definition), Task 5 tests, and Task 6 (call sites). `CHATBOT_SYSTEM_PROMPT_PATH` is the single source of the HTTP path, imported by both the client module test and LivePage. Store `getSystemPrompt`/`setSystemPrompt` names match across Tasks 1-3.
