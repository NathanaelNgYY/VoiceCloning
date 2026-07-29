# Chatbot-only build (DeanVoice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a clean, single-page Live Fast voice chatbot build that auto-loads the dean's cloned voice (`DeanVoice`), deployed to `d2o0cbe2zunqkr.cloudfront.net`.

**Architecture:** Purely additive on the existing client. A new `chatbot` app mode (in `appMode.js`) reuses the generic routing in `App.jsx` to render only `LivePage` chat mode with no nav. `LivePage` derives a `kiosk` flag from the app mode and hides its power-user chrome (voice picker, advanced settings), leaving conversation + mic. Auto-load reuses the existing `?voice=` selection path, fed by a build-time env var. A new Vite `chatbot` build mode + `.env.chatbot` point the bundle at the new CloudFront and name the voice.

**Tech Stack:** React 18, Vite, React Router 6, Node's built-in test runner (`node --test`).

## Global Constraints

- All client packages are ES modules (`"type": "module"`); use `import`/`export`.
- Client path alias `@/` → `client/src/`.
- Do NOT change behavior of the `combined`, `training`, or `live-fast` app modes — chatbot mode is additive only.
- Voice profile `key` normalization is `String(name).toLowerCase().replace(/[\s_-]+/g, '')` (must match `client/src/lib/voiceProfiles.js`).
- Config values for THIS deployment: voice `DeanVoice`; CloudFront `https://d2o0cbe2zunqkr.cloudfront.net`; S3 `interns2026-small-projects-bucket-shared/echolect/`; build output `client/dist-chatbot`.
- Run all commands from `client/` unless stated otherwise.
- Branch: `deployment-with-changes` (already aligned to `separate-containers-new`).

---

## File Structure

- Modify `client/src/lib/appMode.js` — add `chatbot` mode + `kiosk` flag.
- Modify `client/src/lib/appMode.test.js` — cover chatbot mode.
- Create `client/src/lib/chatbotVoice.js` — pure helper resolving the initial voice key from URL/env.
- Create `client/src/lib/chatbotVoice.test.js` — helper tests.
- Modify `client/src/pages/LivePage.jsx` — import `APP_MODE_CONFIG`, derive `kiosk`, use the helper for env-fallback voice selection, wrap two power-user clusters in `{!kiosk && (...)}`.
- Create `client/.env.chatbot` — build env (mode, CloudFront URLs, voice id).
- Modify `client/package.json` — add `build:chatbot` script.

---

### Task 1: `chatbot` app mode

**Files:**
- Modify: `client/src/lib/appMode.js`
- Test: `client/src/lib/appMode.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getAppModeConfig('chatbot')` → `{ mode:'chatbot', kiosk:true, showTraining:false, showLiveFast:true, showTextToSpeech:false, navItems:[], defaultPath:'/', subtitle:'Live Fast Chatbot' }`. `normalizeAppMode('chatbot'|'dean'|'kiosk')` → `'chatbot'`. The `kiosk` boolean is read by `LivePage` (Task 3/4) via `APP_MODE_CONFIG`.

- [ ] **Step 1: Write the failing tests** — append to `client/src/lib/appMode.test.js`:

```js
test('normalizeAppMode resolves chatbot and its aliases', () => {
  assert.equal(normalizeAppMode('chatbot'), 'chatbot');
  assert.equal(normalizeAppMode('dean'), 'chatbot');
  assert.equal(normalizeAppMode('kiosk'), 'chatbot');
});

test('getAppModeConfig exposes only the chatbot with no nav in chatbot mode', () => {
  const config = getAppModeConfig('chatbot');

  assert.equal(config.kiosk, true);
  assert.equal(config.showTraining, false);
  assert.equal(config.showLiveFast, true);
  assert.equal(config.showTextToSpeech, false);
  assert.equal(config.defaultPath, '/');
  assert.equal(config.subtitle, 'Live Fast Chatbot');
  assert.deepEqual(config.navItems, []);
});

test('getAppModeConfig leaves live-fast mode unchanged', () => {
  const config = getAppModeConfig('live-fast');
  assert.equal(config.kiosk, false);
  assert.deepEqual(config.navItems.map((i) => i.label), ['Live Fast', 'Text to Speech']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/lib/appMode.test.js`
Expected: FAIL — chatbot tests fail (`kiosk` is `undefined`, `navItems` not empty, `showLiveFast` false).

- [ ] **Step 3: Implement the mode** — in `client/src/lib/appMode.js`:

Replace the `APP_MODES` line:
```js
const APP_MODES = new Set(['combined', 'training', 'live-fast', 'chatbot']);
```

In `normalizeAppMode`, add the alias line before the final `return`:
```js
  if (normalized === 'dean' || normalized === 'kiosk') return 'chatbot';
```

Replace the body of `getAppModeConfig` with:
```js
export function getAppModeConfig(value) {
  const mode = normalizeAppMode(value);
  const kiosk = mode === 'chatbot';
  const showTraining = mode === 'combined' || mode === 'training';
  const showLiveFast = mode === 'combined' || mode === 'live-fast' || mode === 'chatbot';
  const showTextToSpeech = mode === 'combined' || mode === 'live-fast';
  const navItems = [];

  if (!kiosk) {
    if (showTraining) {
      navItems.push({ label: 'Training', to: '/', end: true });
    }

    if (showLiveFast) {
      navItems.push({ label: 'Live Fast', to: showTraining ? '/live-fast' : '/', end: !showTraining });
    }

    if (showTextToSpeech) {
      navItems.push({ label: 'Text to Speech', to: showTraining ? '/text-to-speech' : '/?tab=text-to-speech', end: true });
    }
  }

  return {
    mode,
    kiosk,
    showTraining,
    showLiveFast,
    showTextToSpeech,
    navItems,
    defaultPath: '/',
    subtitle: showTraining && showLiveFast
      ? 'GPT-SoVITS Training & Live Fast'
      : showTraining
        ? 'GPT-SoVITS Training'
        : 'Live Fast Chatbot',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/lib/appMode.test.js`
Expected: PASS — all tests (existing 4 + new 3) pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/appMode.js client/src/lib/appMode.test.js
git commit -m "feat(client): add chatbot app mode (kiosk, no nav, chatbot only)"
```

---

### Task 2: `chatbotVoice` helper

**Files:**
- Create: `client/src/lib/chatbotVoice.js`
- Test: `client/src/lib/chatbotVoice.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeVoiceKey(name) → string`; `resolveInitialVoiceKey({ search, envVoiceId }) → string` (normalized profile key, `''` when neither source provides one; `?voice=` URL param wins over env). Consumed by `LivePage` in Task 3.

- [ ] **Step 1: Write the failing test** — create `client/src/lib/chatbotVoice.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeVoiceKey, resolveInitialVoiceKey } from './chatbotVoice.js';

test('normalizeVoiceKey lowercases and strips separators', () => {
  assert.equal(normalizeVoiceKey('DeanVoice'), 'deanvoice');
  assert.equal(normalizeVoiceKey('Dean Voice'), 'deanvoice');
  assert.equal(normalizeVoiceKey('dean_voice-01'), 'deanvoice01');
  assert.equal(normalizeVoiceKey(''), '');
  assert.equal(normalizeVoiceKey(null), '');
});

test('resolveInitialVoiceKey prefers ?voice= over env', () => {
  assert.equal(
    resolveInitialVoiceKey({ search: '?voice=SomeOne', envVoiceId: 'DeanVoice' }),
    'someone',
  );
});

test('resolveInitialVoiceKey falls back to env when no url param', () => {
  assert.equal(resolveInitialVoiceKey({ search: '', envVoiceId: 'DeanVoice' }), 'deanvoice');
});

test('resolveInitialVoiceKey returns empty when neither provided', () => {
  assert.equal(resolveInitialVoiceKey({ search: '', envVoiceId: '' }), '');
  assert.equal(resolveInitialVoiceKey(), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/chatbotVoice.test.js`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Write minimal implementation** — create `client/src/lib/chatbotVoice.js`:

```js
export function normalizeVoiceKey(name) {
  return String(name || '').toLowerCase().replace(/[\s_-]+/g, '');
}

export function resolveInitialVoiceKey({ search = '', envVoiceId = '' } = {}) {
  const params = new URLSearchParams(search);
  const fromUrl = params.get('voice');
  const raw = fromUrl && fromUrl.trim() ? fromUrl : envVoiceId;
  return normalizeVoiceKey(raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/chatbotVoice.test.js`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/chatbotVoice.js client/src/lib/chatbotVoice.test.js
git commit -m "feat(client): add chatbotVoice helper for url/env voice selection"
```

---

### Task 3: Auto-load `DeanVoice` in LivePage

**Files:**
- Modify: `client/src/pages/LivePage.jsx` (mount effect around line 2419–2424; imports near top)

**Interfaces:**
- Consumes: `resolveInitialVoiceKey` from Task 2; existing `urlVoiceKeyRef`, `fetchModels`, `checkStatus`, `loadActiveVoiceProfile`.
- Produces: on mount, `urlVoiceKeyRef.current` is seeded from `?voice=` or `VITE_CHATBOT_VOICE_PROFILE_ID`, so the existing auto-select effect (matches `availableProfiles` by `key`) and `shouldLoadSelectedProfile` auto-load the named voice. No new loading pipeline.

- [ ] **Step 1: Add the import** — near the other `@/lib` imports at the top of `client/src/pages/LivePage.jsx`, add:

```js
import { resolveInitialVoiceKey } from '@/lib/chatbotVoice';
```

- [ ] **Step 2: Replace the mount effect** — find this effect (around line 2419):

```js
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const voiceParam = params.get('voice');
    if (voiceParam) urlVoiceKeyRef.current = voiceParam.toLowerCase().replace(/[\s_-]+/g, '');
    fetchModels(); checkStatus(); loadActiveVoiceProfile();
  }, []);
```

Replace it with:

```js
  useEffect(() => {
    const initialVoiceKey = resolveInitialVoiceKey({
      search: window.location.search,
      envVoiceId: import.meta.env.VITE_CHATBOT_VOICE_PROFILE_ID,
    });
    if (initialVoiceKey) urlVoiceKeyRef.current = initialVoiceKey;
    fetchModels(); checkStatus(); loadActiveVoiceProfile();
  }, []);
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds (exit 0), no syntax/import errors.

- [ ] **Step 4: Manual smoke (optional, needs backend)**

Run: `npm run dev:live-fast` then open the app with `?voice=DeanVoice`. Expected: the `DeanVoice` model auto-selects and begins loading without manual selection. (Env-driven auto-load is verified end-to-end in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/LivePage.jsx
git commit -m "feat(client): auto-load voice from VITE_CHATBOT_VOICE_PROFILE_ID"
```

---

### Task 4: Kiosk trim of LivePage

**Files:**
- Modify: `client/src/pages/LivePage.jsx` (imports; component body; two JSX clusters)

**Interfaces:**
- Consumes: `APP_MODE_CONFIG.kiosk` from Task 1.
- Produces: when the build mode is `chatbot`, `LivePage` renders only the title + conversation + mic; the voice/language/engine/save controls cluster and the Advanced-settings collapsible are not rendered. All other modes render unchanged (`kiosk` is `false`).

- [ ] **Step 1: Add the import** — near the top `@/lib` imports of `client/src/pages/LivePage.jsx`, add:

```js
import { APP_MODE_CONFIG } from '@/lib/appMode';
```

- [ ] **Step 2: Derive the `kiosk` flag** — immediately inside the component, just after the signature line `export default function LivePage({ replyMode = 'phrases', mode = 'chat' }) {`, add:

```js
  const kiosk = APP_MODE_CONFIG.kiosk;
```

- [ ] **Step 3: Gate the top controls cluster** — in the render, find the controls container that holds the Voice/Language/Engine selectors and the active-voice-profile/Save block. It opens with:

```jsx
          <div className="flex flex-1 flex-wrap items-center gap-3">
```

and is the sibling that follows the `<h1>…</h1>` title inside the header row. Wrap this entire element (from that opening `<div>` through its matching closing `</div>`) so it only renders when not in kiosk mode:

```jsx
          {!kiosk && (
          <div className="flex flex-1 flex-wrap items-center gap-3">
            {/* …existing Voice / Language / Engine / status / Save / active-profile… */}
          </div>
          )}
```

Leave the `<h1>` title in place (it stays visible in kiosk mode). Match the correct closing `</div>` using your editor's JSX bracket matching — it is the one that closes the `flex flex-1 flex-wrap` container (which contains the `ml-auto` active-profile block as its last child).

- [ ] **Step 4: Gate the Advanced-settings collapsible** — find this block (around line 3588), which begins:

```jsx
      {/* ── Advanced settings collapsible ── */}
      <Collapsible open={showSettings} onOpenChange={setShowSettings}>
```

Wrap the whole `<Collapsible>…</Collapsible>` element so it only renders when not in kiosk mode:

```jsx
      {!kiosk && (
      <Collapsible open={showSettings} onOpenChange={setShowSettings}>
        {/* …existing advanced settings (references, transcript, configs, sliders, Live Full)… */}
      </Collapsible>
      )}
```

The closing tag to match is the `</Collapsible>` that pairs with this `open={showSettings}` opener.

- [ ] **Step 5: Run the app-mode and helper tests (regression) + build**

Run: `node --test src/lib/appMode.test.js src/lib/chatbotVoice.test.js`
Expected: PASS.

Run: `npm run build`
Expected: build succeeds (exit 0), no unterminated-JSX errors.

- [ ] **Step 6: Manual visual check (both modes)**

Run: `npm run dev` (combined) — confirm the full page is unchanged: voice picker, language/engine, and "Show advanced settings" are all visible.
Run: `npm run dev:chatbot` (added in Task 5; or `vite --mode chatbot`) — confirm only the title + conversation + mic show: no voice/language/engine controls, no advanced-settings toggle, and no nav bar.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/LivePage.jsx
git commit -m "feat(client): kiosk-trim LivePage in chatbot mode (hide power-user chrome)"
```

---

### Task 5: Chatbot build mode + env

**Files:**
- Create: `client/.env.chatbot`
- Modify: `client/package.json` (scripts)

**Interfaces:**
- Consumes: `chatbot` app mode (Task 1), `VITE_CHATBOT_VOICE_PROFILE_ID` reader (Task 3), runtime URL readers in `client/src/lib/runtimeConfig.js` (`VITE_API_BASE_URL`, `VITE_GPU_WORKER_URL`, `VITE_APP_BASENAME`).
- Produces: `npm run build:chatbot` → `client/dist-chatbot`; `npm run dev:chatbot` for local preview.

- [ ] **Step 1: Create `client/.env.chatbot`**

```
VITE_APP_MODE=chatbot
VITE_API_BASE_URL=https://d2o0cbe2zunqkr.cloudfront.net
VITE_GPU_WORKER_URL=https://d2o0cbe2zunqkr.cloudfront.net
VITE_CHATBOT_VOICE_PROFILE_ID=DeanVoice
VITE_APP_BASENAME=/
```

- [ ] **Step 2: Add scripts** — in `client/package.json`, add to `"scripts"` (after `build:live-fast`):

```json
    "dev:chatbot": "vite --mode chatbot --host 0.0.0.0 --port 5175 --strictPort",
    "build:chatbot": "vite build --mode chatbot --outDir dist-chatbot",
```

- [ ] **Step 3: Build it**

Run: `npm run build:chatbot`
Expected: succeeds; `client/dist-chatbot/index.html` and assets exist.

- [ ] **Step 4: Verify the build is chatbot-only** — preview the built bundle:

Run: `npm run preview -- --outDir dist-chatbot`
Expected: page shows only the chatbot (no nav, no voice picker, no advanced settings). (Backend calls will fail locally — that is expected; we only verify the UI shape here.)

- [ ] **Step 5: Commit**

```bash
git add client/.env.chatbot client/package.json
git commit -m "build(client): add chatbot vite mode, env, and build:chatbot script"
```

---

### Task 6: Deploy to CloudFront

**Files:** none (manual deploy + verification).

**Interfaces:**
- Consumes: `client/dist-chatbot` (Task 5); the `separate-containers-new` backend already wired behind `d2o0cbe2zunqkr.cloudfront.net`; AWS CLI credentials with access to `interns2026-small-projects-bucket-shared` and the CloudFront distribution.
- Produces: the live chatbot at `https://d2o0cbe2zunqkr.cloudfront.net`.

> **Open item (confirm before sync):** identify which `echolect/<dist-*>` folder the `d2o0cbe2zunqkr` CloudFront S3 origin path serves. Either (a) sync the chatbot build into that exact folder, or (b) create `echolect/dist-chatbot/` and repoint the distribution's S3 origin path to `/echolect/dist-chatbot`. The commands below assume option (b).

- [ ] **Step 1: Build the production bundle**

Run (from `client/`): `npm run build:chatbot`
Expected: `client/dist-chatbot` produced with the chatbot bundle.

- [ ] **Step 2: Upload to S3**

Run: `aws s3 sync dist-chatbot s3://interns2026-small-projects-bucket-shared/echolect/dist-chatbot --delete`
Expected: assets uploaded; `--delete` removes stale files.

- [ ] **Step 3: Point CloudFront at the build (if using option b)**

Set the distribution's S3 origin path to `/echolect/dist-chatbot` (console or `aws cloudfront update-distribution`). Skip if you synced into the already-served folder (option a).

- [ ] **Step 4: Invalidate the CloudFront cache**

Run: `aws cloudfront create-invalidation --distribution-id <DISTRIBUTION_ID_FOR_d2o0cbe2zunqkr> --paths "/*"`
Expected: invalidation created; wait for `Completed`.

- [ ] **Step 5: Verify live end-to-end**

Open `https://d2o0cbe2zunqkr.cloudfront.net`. Expected: chatbot-only page loads; `DeanVoice` auto-loads to "Ready"; clicking the mic and speaking returns a reply in the cloned voice. If the model does not auto-load, confirm a `DeanVoice-eNN.ckpt` / `DeanVoice-eNN.pth` pair exists under `echolect/models/` so a profile with `key` `deanvoice` is built.

- [ ] **Step 6: Push the branch (optional, record-keeping)**

The deploy is build+upload and does not require a push. To keep origin in sync, push `deployment-with-changes` (a force-push is needed because origin diverged — backups `backup/dwc-old` and `backup/dwc-origin` exist):

```bash
git push --force-with-lease origin deployment-with-changes
```

---

## Self-Review

**Spec coverage:**
- Chatbot-only single page, no nav, no TTS → Task 1 (`navItems:[]`, `showTextToSpeech:false`) + existing routing.
- Kiosk trim of LivePage → Task 4.
- Auto-load DeanVoice → Tasks 2 + 3 + `.env.chatbot` (Task 5).
- Build + deploy to new CloudFront → Tasks 5 + 6.
- Reuse separate-containers-new backend → Task 6 (no backend changes).
- "Other modes untouched" constraint → Task 1 test `getAppModeConfig leaves live-fast mode unchanged` + Task 4 Step 6 combined-mode visual check.

**Placeholder scan:** No TBD/TODO. The single "Open item" in Task 6 is a real deploy-time confirmation (which S3 folder CloudFront serves) with both resolution paths spelled out — not an undecided design point.

**Type consistency:** `kiosk` defined in Task 1 config, read in Tasks 3/4 via `APP_MODE_CONFIG.kiosk`. `resolveInitialVoiceKey({ search, envVoiceId })` signature identical in Task 2 definition and Task 3 call. `VITE_CHATBOT_VOICE_PROFILE_ID` consistent across Task 3 (reader) and Task 5 (`.env.chatbot`). Voice-key normalization identical to `voiceProfiles.js` (verified).
