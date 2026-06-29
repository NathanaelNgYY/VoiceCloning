# Chatbot-only build (DeanVoice) — design

**Date:** 2026-06-29
**Status:** Approved (design), pending spec review
**Target:** A clean, single-page Live Fast voice chatbot for a non-technical user (the dean) to test his cloned voice, deployed to CloudFront `d2o0cbe2zunqkr.cloudfront.net`.

## Goal

Produce a stripped-down frontend build that shows **only** the Live Fast voice chatbot — no training, no Text-to-Speech tab, no nav bar, and no power-user chrome (model picker, voice-profile manager, config editor, debug panels). The dean opens the page, his voice (`DeanVoice`) is already loaded, and he clicks the mic and talks.

This is purely additive on the existing client. The `combined`, `training`, and `live-fast` modes are untouched. The backend (Lambda router, live-gateway, inference worker) is the existing `separate-containers-new` deployment already wired behind the new CloudFront distribution.

## Non-goals

- No new backend work. Reuses existing Lambda / live-gateway / inference worker and CloudFront origins.
- No training flow in this build (the voice is trained ahead of time).
- No changes to the other app modes or to `LivePage`'s behavior outside `chatbot` mode.

## Architecture

The client already supports build-time **app modes** via `client/src/lib/appMode.js` (`combined` / `training` / `live-fast`) selected by `VITE_APP_MODE`, with matching Vite build scripts (`build:training` → `dist-training`, `build:live-fast` → `dist-live-fast`). `LivePage` is a single component driven by props: `mode="chat"` is the live chatbot, `mode="tts"` is Text-to-Speech. We add a fourth mode and a kiosk trim.

### 1. New `chatbot` app mode (`appMode.js`)

Add `chatbot` to the mode set with:

- `showTraining = false`
- `showLiveFast = true`
- `showTextToSpeech = false`
- `navItems = []` (no nav bar rendered)
- `defaultPath = '/'`
- `subtitle = 'Live Fast Chatbot'`

`normalizeAppMode` accepts `chatbot` (and a tolerant alias, e.g. `dean`). Existing modes keep their current config exactly.

### 2. Routing (`App.jsx`)

In `chatbot` mode, `/` renders `LivePage` chat mode (`replyMode="phrases"`, default `mode="chat"`). Every other route (`/live-fast`, `/text-to-speech`, `/inference`, `/live`, `*`) redirects to `/`. The nav bar is not rendered when `navItems` is empty.

### 3. Kiosk trim of `LivePage` chat mode

When the active app mode is `chatbot`, hide the power-user controls so only the mic + conversation remain:

- Model / voice-profile selector dropdown
- Voice-profile save / manage / sync controls
- Live config editor and saved-config UI
- Debug / diagnostic panels and verbose status messaging

These are gated behind a single mode check (e.g. a `kiosk`/`chatbotMode` boolean derived from `APP_MODE_CONFIG.mode === 'chatbot'`), so the full app is unaffected. The conversation transcript, mic button, and minimal connection/loading status remain visible.

### 4. Auto-load `DeanVoice`

A build-time env var names the pre-trained voice:

```
VITE_CHATBOT_VOICE_PROFILE_ID=DeanVoice
```

On mount in `chatbot` mode, this value feeds the **existing** auto-select + auto-load + best-reference machinery in `LivePage` (the "rank one" / auto-config logic): match the named profile against `availableProfiles` (by key or display name, tolerant — reuses the precedent in `findSavedVoiceProfileKey` / `urlVoiceKeyRef`), select it, trigger model load, and auto-apply the best reference set. If the var is empty or the profile is not found, fall back to the current default auto-select behavior. No new loading pipeline is introduced.

### 5. Build + deploy

Add a Vite mode and script:

- `client/.env.chatbot`:
  ```
  VITE_APP_MODE=chatbot
  VITE_API_BASE_URL=https://d2o0cbe2zunqkr.cloudfront.net
  VITE_GPU_WORKER_URL=https://d2o0cbe2zunqkr.cloudfront.net
  VITE_CHATBOT_VOICE_PROFILE_ID=DeanVoice
  VITE_APP_BASENAME=/
  ```
- `client/package.json`: `"build:chatbot": "vite build --mode chatbot --outDir dist-chatbot"`

Deploy (manual, matching existing convention — builds upload as folders under `echolect/`):

```
cd client && npm run build:chatbot
aws s3 sync client/dist-chatbot s3://interns2026-small-projects-bucket-shared/echolect/dist-chatbot --delete
# CloudFront invalidation for d2o0cbe2zunqkr (path /* )
```

**Open deploy detail:** confirm which `echolect/<dist-*>` folder the `d2o0cbe2zunqkr` CloudFront S3 origin path points to. If it already targets an existing folder, either upload there or repoint the origin path to `dist-chatbot`.

## Components / boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `appMode.js` (`chatbot` config) | Declare what the chatbot build shows | none (pure) |
| `App.jsx` routing | Render single chatbot route, drop nav | `appMode.js`, `LivePage` |
| `LivePage` kiosk trim | Hide power-user chrome in chatbot mode | `APP_MODE_CONFIG.mode` |
| Auto-load voice | Select + load `DeanVoice` on mount | existing model-load / best-ref logic, `VITE_CHATBOT_VOICE_PROFILE_ID` |
| `.env.chatbot` + `build:chatbot` | Produce `dist-chatbot` pointed at new CloudFront | Vite |

## Error handling / edge cases

- Voice not found / not trained: fall back to existing auto-select; show a minimal non-technical status ("Preparing voice…" / "Voice unavailable, please try again").
- Backend/model still warming: keep the existing loading state; mic disabled until ready.
- Empty `VITE_CHATBOT_VOICE_PROFILE_ID`: behaves like current default auto-select (no crash).

## Testing

- Unit: `appMode.js` returns the expected config for `chatbot` (no nav, chatbot only, correct subtitle) and leaves other modes unchanged (extend `appMode.test.js`).
- Unit: voice-name matching helper resolves `DeanVoice` against a profile list (key and display-name cases, miss case).
- Manual: `npm run dev` with `--mode chatbot` → single chatbot page, no nav/TTS, `DeanVoice` auto-loads, mic works end-to-end against the deployed backend.

## Config values (this deployment)

- Voice profile id: `DeanVoice`
- CloudFront: `https://d2o0cbe2zunqkr.cloudfront.net`
- S3 bucket/prefix: `interns2026-small-projects-bucket-shared/echolect/`
- Build output: `client/dist-chatbot` → `echolect/dist-chatbot/`
- Branch: `deployment-with-changes` (already aligned to `separate-containers-new`; CloudFront deploy pipeline runs from here)
