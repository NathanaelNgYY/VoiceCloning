# Chatbot Live Full — Design Spec

**Date:** 2026-06-30
**Status:** Proposed (awaiting review)

## Goal

Make the system-prompt chatbot (kiosk build, served by the chatbot CloudFront
`d2o0cbe2zunqkr.cloudfront.net`) speak its replies through **Live Full** — the
full GPT-SoVITS inference pipeline with the latest quality improvements — instead
of the current Live Fast phrase streaming. The normal CloudFront and its frontend
are untouched.

## Background — current state

The work is split across two branches that share base `51b4567`:

- **`separate-containers-new`** has the *latest Live Full*:
  - Backend (`gpu-inference-worker/`): best-of-N voice-faithful takes,
    speaker-similarity gate, transcription/whisper verification, word-coverage,
    Full Inference Queue. **Already deployed on EC2** (the `voice-live-gateway`
    + inference worker run this branch).
  - Client: an **Engine toggle** (`liveEngine`: `'fast'` | `'full'`) wired into
    `useLiveSpeech`; `liveFullRefParams` auto-derived from the Live Fast rank-1
    voice via `buildLiveFullRefParamsFromLiveFastRankOne(voiceConfigs[0])`; and
    **progressive queued full playback** in the live conversation
    (`synthesizeFullQueuedAssistantReply` → `startGeneration` →
    `connectInferenceSSE` → `getInferenceChunk` per chunk).
  - The gateway `session.init` system-prompt handshake (rebased on, commits
    `1de9e0a` / `02c74d5` / `e282c7b`).

- **`chatbot-system-prompt`** has the *chatbot kiosk shell* (NOT on the other
  branch): chatbot app mode (kiosk, no nav), `chatbotVoice` helper + DeanVoice
  auto-load from `VITE_CHATBOT_VOICE_PROFILE_ID`, kiosk-trim of LivePage,
  Advanced Settings in kiosk, the editable **system-prompt panel**, and the
  `build:chatbot` vite mode / `.env.chatbot` / gitignored `dist-chatbot/`.

Today the chatbot renders `<LivePage replyMode="phrases" mode="chat" />` with the
default `liveEngine = 'fast'`, so it uses Live Fast.

## Approach — integrate via merge

Create branch **`chatbot-live-full`** off `separate-containers-new` and
`git merge origin/chatbot-system-prompt`. Both branches heavily edit
`LivePage.jsx` and `App.jsx`, so a single 3-way merge resolves everything in one
pass — cleaner than replaying ~12 cherry-picks that each re-conflict on the same
files. The duplicate gateway commits are textually identical and collapse cleanly.

Rejected alternatives:
- **Cherry-pick the chatbot frontend commits onto `separate-containers-new`** —
  repeated conflicts on `LivePage.jsx`/`App.jsx`, 12× the resolution effort.
- **Merge `separate-containers-new` into `chatbot-system-prompt`** — works, but
  pollutes the chatbot branch with backend history and risks confusing which
  branch EC2 tracks. A fresh integration branch keeps boundaries clear.

The chatbot frontend is a static S3 build, so the branch it builds from does not
affect EC2; EC2 stays on `separate-containers-new`.

## Changes

1. **Default kiosk engine to Live Full.** In chatbot/kiosk mode, initialize
   `liveEngine` to `'full'` (currently `'fast'`). The **engine toggle stays
   visible** so a user can switch to Live Fast if a reply feels too slow.
2. **Preserve the system-prompt panel + `session.init` handshake** (carried in
   by the merge).
3. **No backend change** — the Live Full inference improvements are already
   deployed on EC2.

## Key risk

`buildLiveFullRefParamsFromLiveFastRankOne` needs `voiceConfigs[0]` (the Live Fast
rank-1 reference) populated. In kiosk the voice is auto-loaded from
`VITE_CHATBOT_VOICE_PROFILE_ID` (DeanVoice). The plan must verify that auto-load
populates `voiceConfigs[0]` so Live Full has a reference; otherwise full inference
fails with "Create or load Live Fast rank #1 before generating Full Inference
audio." This is the primary integration point to test.

## Testing / verification

- `cd live-gateway && npm test` and `cd client && npm test` (node:test) green
  after the merge.
- Local kiosk run (`npm run dev:chatbot`): confirm engine defaults to Full, a
  spoken reply runs full inference with progressive chunk playback, the
  system-prompt panel still appears and is applied, and the toggle can switch to
  Fast.
- Confirm DeanVoice resolves Live Full ref params (no "rank #1" error).

## Deploy

1. `npm run build:chatbot` from `chatbot-live-full` → `client/dist-chatbot/`.
2. `aws s3 sync client/dist-chatbot/ s3://<CHATBOT_BUCKET>/<PREFIX?>/ --delete`.
3. `aws cloudfront create-invalidation --distribution-id <CHATBOT_DIST_ID> --paths "/*"`.
4. EC2 backend already on `separate-containers-new` — no backend deploy needed.

## Out of scope

- Normal CloudFront frontend and the main app (unchanged).
- Any backend / EC2 change (Live Full backend already deployed).
- Removing the engine toggle (kept visible per decision).
