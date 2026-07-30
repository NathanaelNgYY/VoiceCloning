# Chatbot Live Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the kiosk chatbot (system-prompt build) speak replies through Live Full by default, by integrating the latest Live Full code into the chatbot branch and defaulting the kiosk engine to `'full'`.

**Architecture:** A single `git merge` of `separate-containers-new` (latest Live Full client + backend, progressive queued playback, gateway handshake) into the `chatbot-live-full` branch (which already carries the kiosk shell + system-prompt panel from `chatbot-system-prompt`). Then one small, unit-tested change: `getAppModeConfig` exposes `defaultLiveEngine` (`'full'` in kiosk, else `'fast'`), and `LivePage` initializes its engine state from it. The engine toggle stays visible.

**Tech Stack:** React 18 + Vite (client), Node.js ESM, `node:test` for tests (NOT Vitest), git.

## Global Constraints

- All packages use ES modules (`import`/`export`).
- Client tests run with `node --test` (`node:test` + `node:assert/strict`) — NOT Vitest, no jsdom. Tests must be pure-function tests.
- Client path alias `@/` maps to `client/src/`.
- EC2 stays on `separate-containers-new`; the chatbot frontend is a static S3 build, so the build branch does not affect EC2. Do NOT push to or alter `separate-containers-new`.
- Conflict-resolution rule for the gateway safety-net timeout: keep the `200`ms version from `separate-containers-new` (deployed + correct), discard the `1000`ms version.

---

### Task 1: Integrate Live Full via merge

**Files:**
- Modify (conflict resolution): `live-gateway/src/routes/liveChat.js` (around lines 181-190)
- Merge brings in (no manual edit): `client/src/pages/LivePage.jsx` (auto-merges clean), all `gpu-inference-worker/*` Live Full files.

**Interfaces:**
- Produces: a merged `chatbot-live-full` branch containing `liveEngine`/`setLiveEngine` state, `buildLiveFullRefParamsFromLiveFastRankOne`, `synthesizeFullQueuedAssistantReply`, the kiosk shell, and the system-prompt panel — all in one tree.

- [ ] **Step 1: Confirm you are on the integration branch with a clean tree**

Run:
```bash
git switch chatbot-live-full
git status --short
```
Expected: branch is `chatbot-live-full`; only possible noise is ` M client/package-lock.json` (a pre-existing stray change — ignore it, do not stage it).

- [ ] **Step 2: Start the merge**

Run:
```bash
git merge --no-ff separate-containers-new
```
Expected: `Auto-merging client/src/pages/LivePage.jsx`, then `CONFLICT (content): Merge conflict in live-gateway/src/routes/liveChat.js`, then `Automatic merge failed`. Only `liveChat.js` conflicts.

- [ ] **Step 3: Verify the conflict set is exactly one file**

Run:
```bash
git diff --name-only --diff-filter=U
```
Expected: a single line — `live-gateway/src/routes/liveChat.js`. If any other file is listed, STOP and re-read this plan.

- [ ] **Step 4: Resolve the conflict — keep the 200ms version**

In `live-gateway/src/routes/liveChat.js`, replace the entire conflict block:

```js
    // Safety net: a client that never sends session.init must not hang.
<<<<<<< HEAD
    const initTimer = setTimeout(ensureConnected, 1000);
=======
    // Kept short so frontends that don't send a handshake (e.g. the normal
    // client, which waits for session.ready before sending anything) connect
    // promptly; still leaves margin for a chatbot client's session.init,
    // which is sent the instant the socket opens.
    const initTimer = setTimeout(ensureConnected, 200);
>>>>>>> separate-containers-new
```

with the resolved version (no markers):

```js
    // Safety net: a client that never sends session.init must not hang.
    // Kept short so frontends that don't send a handshake (e.g. the normal
    // client, which waits for session.ready before sending anything) connect
    // promptly; still leaves margin for a chatbot client's session.init,
    // which is sent the instant the socket opens.
    const initTimer = setTimeout(ensureConnected, 200);
```

- [ ] **Step 5: Stage the resolution and confirm no markers remain**

Run:
```bash
git add live-gateway/src/routes/liveChat.js
git diff --check
```
Expected: no output (no leftover conflict markers).

- [ ] **Step 6: Run the gateway tests**

Run:
```bash
cd live-gateway && npm test
```
Expected: all tests pass (32 at time of writing, including `session.update uses an overridden systemPrompt set before connect`). Return to repo root afterward: `cd ..`.

- [ ] **Step 7: Run the client tests**

Run:
```bash
cd client && npm install && npm test
```
Expected: all tests pass (node:test). Return to repo root: `cd ..`.

- [ ] **Step 8: Complete the merge commit**

Run:
```bash
git commit --no-edit
```
Expected: a merge commit on `chatbot-live-full`. (`--no-edit` keeps the default merge message.)

---

### Task 2: Default the kiosk engine to Live Full

**Files:**
- Test: `client/src/lib/appMode.test.js`
- Modify: `client/src/lib/appMode.js` (the `getAppModeConfig` return object)
- Modify: `client/src/pages/LivePage.jsx` (the `liveEngine` `useState` initializer)

**Interfaces:**
- Consumes: `getAppModeConfig(value)` from Task 1's tree (returns `{ mode, kiosk, showTraining, showLiveFast, showTextToSpeech, navItems, defaultPath, subtitle }`).
- Produces: `getAppModeConfig(...)` additionally returns `defaultLiveEngine: 'full' | 'fast'`; `APP_MODE_CONFIG.defaultLiveEngine` consumed by `LivePage`.

- [ ] **Step 1: Write the failing test**

Add to `client/src/lib/appMode.test.js`:

```js
test('getAppModeConfig defaults the live engine to full only in chatbot mode', () => {
  assert.equal(getAppModeConfig('chatbot').defaultLiveEngine, 'full');
  assert.equal(getAppModeConfig('combined').defaultLiveEngine, 'fast');
  assert.equal(getAppModeConfig('live-fast').defaultLiveEngine, 'fast');
  assert.equal(getAppModeConfig('training').defaultLiveEngine, 'fast');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd client && npm test
```
Expected: FAIL — the new assertions report `undefined` is not equal to `'full'`/`'fast'`. (Run from `client/`; return with `cd ..` after.)

- [ ] **Step 3: Add `defaultLiveEngine` to the config**

In `client/src/lib/appMode.js`, inside the object returned by `getAppModeConfig`, add the field (place it next to `kiosk`):

```js
  return {
    mode,
    kiosk,
    defaultLiveEngine: kiosk ? 'full' : 'fast',
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd client && npm test
```
Expected: PASS. (Return with `cd ..`.)

- [ ] **Step 5: Wire LivePage to the config default**

In `client/src/pages/LivePage.jsx`, find the engine state initializer (it reads, after the merge):

```js
  // Chatbot synthesis engine: 'fast' (live/tts-sentence) or 'full' (/inference for accuracy).
  const [liveEngine, setLiveEngine] = useState('fast');
```

Change the initializer to use the mode config (`APP_MODE_CONFIG` is already imported in this file and `kiosk` is derived from it near the top of the component):

```js
  // Chatbot synthesis engine: 'fast' (live/tts-sentence) or 'full' (/inference for accuracy).
  // Kiosk defaults to Live Full for best voice quality; the toggle stays visible.
  const [liveEngine, setLiveEngine] = useState(APP_MODE_CONFIG.defaultLiveEngine);
```

- [ ] **Step 6: Verify the full client test suite still passes**

Run:
```bash
cd client && npm test
```
Expected: PASS (no regressions). Return: `cd ..`.

- [ ] **Step 7: Commit**

Run:
```bash
git add client/src/lib/appMode.js client/src/lib/appMode.test.js client/src/pages/LivePage.jsx
git commit -m "feat(client): default kiosk chatbot to Live Full engine"
```

---

### Task 3: Build, verify kiosk behavior, and deploy

**Files:**
- Produces: `client/dist-chatbot/` (gitignored build output).

**Interfaces:**
- Consumes: `defaultLiveEngine` wiring from Task 2; `.env.chatbot` (`VITE_APP_MODE=chatbot`, `VITE_API_BASE_URL=https://d2o0cbe2zunqkr.cloudfront.net`, `VITE_CHATBOT_VOICE_PROFILE_ID=DeanVoice`).

- [ ] **Step 1: Produce the kiosk build**

Run:
```bash
cd client && npm run build:chatbot
```
Expected: a successful Vite build into `client/dist-chatbot/` with no errors. Return: `cd ..`.

- [ ] **Step 2: Manually verify kiosk behavior (local)**

Run:
```bash
cd client && npm run dev:chatbot
```
Open `http://localhost:5175`. Confirm ALL of the following, then stop the dev server:
1. The **Engine** toggle is visible and **defaults to Live Full**.
2. The **"Assistant instructions"** system-prompt panel is present beside the chat.
3. Starting a conversation and getting a reply runs full inference with **progressive chunk playback** (audio starts before the whole reply is done) — and produces **no** `Create or load Live Fast rank #1 before generating Full Inference audio` error (this confirms DeanVoice auto-load populates the rank-1 reference that `buildLiveFullRefParamsFromLiveFastRankOne` needs — the spec's key risk).
4. Switching the toggle to Live Fast still works.

If check #3 raises the "rank #1" error, STOP: the kiosk DeanVoice auto-load is not populating `voiceConfigs[0]`. File this as a blocker — Live Full has no reference. (Likely fix area: the chatbot voice auto-load in `LivePage.jsx` / `chatbotVoice.js` must seed `voiceConfigs[0]` before a reply is synthesized.)

- [ ] **Step 3: Deploy to the chatbot CloudFront**

Fill in the bucket/prefix and distribution ID for the chatbot CloudFront (`d2o0cbe2zunqkr.cloudfront.net`). To discover them:
```bash
aws cloudfront list-distributions --query "DistributionList.Items[?contains(DomainName, 'd2o0cbe2zunqkr')].{Id:Id,Origin:Origins.Items[0].DomainName}"
```
Then:
```bash
aws s3 sync client/dist-chatbot/ s3://<CHATBOT_BUCKET>/<PREFIX-IF-ANY>/ --delete
aws cloudfront create-invalidation --distribution-id <CHATBOT_DIST_ID> --paths "/*"
```
Expected: sync uploads the new bundle; invalidation returns an `Id` with status `InProgress`.

- [ ] **Step 4: Post-deploy smoke test**

After the invalidation completes (~1 min), hard-refresh `https://d2o0cbe2zunqkr.cloudfront.net` and repeat the four checks from Step 2 against the live chatbot. The EC2 backend already runs `separate-containers-new`, so the Live Full inference improvements are active.

- [ ] **Step 5: Push the integration branch (optional, for record/CI)**

Run:
```bash
git push -u origin chatbot-live-full
```
(Do this only if you want the branch on origin. EC2 is unaffected either way.)

---

## Self-Review

**Spec coverage:**
- Goal (kiosk → Live Full): Task 2 (engine default) + Task 1 (brings Live Full in). ✓
- Integration via merge into `chatbot-live-full`: Task 1. ✓
- Toggle visible, default Full: Task 2 Step 5 + Task 3 Step 2 check #1. ✓
- System-prompt panel preserved: Task 3 Step 2 check #2 (carried by merge). ✓
- Key risk (DeanVoice → fullRefParams): Task 3 Step 2 check #3. ✓
- Deploy (build:chatbot → S3 → invalidation): Task 3 Steps 1, 3, 4. ✓
- EC2 untouched / backend already deployed: Global Constraints + Task 3 Step 4. ✓

**Placeholder scan:** Only `<CHATBOT_BUCKET>` / `<CHATBOT_DIST_ID>` remain — genuine per-environment inputs with a discovery command provided, not implementation gaps. ✓

**Type consistency:** `defaultLiveEngine` is defined in Task 2 Step 3 and consumed in Task 2 Step 5; values `'full'`/`'fast'` match `liveEngine`'s existing domain and `useLiveSpeech`'s `engine` param. ✓
