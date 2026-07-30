# GI-Bleeding Skin as a New `gi` Build Mode — Design

**Date:** 2026-07-20
**Status:** Approved, ready for planning
**Source:** https://github.com/jiasshengg/gi-bleeding (frontend only)

## Goal

Adopt the gi-bleeding chat interface as a new build target of the Voice Cloning
Studio client, driven by the **existing** live-chat engine and GPT-SoVITS cloned
voice. No existing feature is removed from the codebase; Training and
Text-to-Speech are simply not reachable from the new mode's UI.

## Non-Goals

- Porting gi-bleeding's backend (Lambda, OpenAI Realtime, S3 retrieval, RAG).
- LiveKit avatar video (`useAvatarSession`, `livekit-client`).
- Multi-conversation history persistence.
- Upgrading React 18 → 19, Tailwind 3 → 4, or react-router 6 → 7.
- Any modification to `TrainingPage.jsx`, `InferencePage.jsx`, or `LivePage.jsx`.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **UI skin only.** Port the presentation layer; drive it with the existing engine. | Preserves the cloned GPT-SoVITS voice, which is the project's core value. gi-bleeding's hooks would replace it with stock OpenAI voices. |
| D2 | **New `gi` build mode**, alongside `chatbot`. | The shipped `dist-chatbot` (Dean demo) keeps working untouched; both skins can be compared. |
| D3 | **Sidebar kept; "New chat" clears the transcript.** No conversation list or persistence. | Preserves the visual layout at zero persistence cost. |
| D4 | **VoicePicker only**, backed by existing voice profiles. AvatarPicker dropped. | Without LiveKit there is no avatar video to pick. A cloned-voice selector reuses logic already present. |
| D4a | **Amended 2026-07-20 during planning: the picker ships read-only.** It lists profiles and shows the active one, but cannot switch. | `activateVoiceProfile(profile)` takes a full profile payload built from the target's saved rank-1 config, and switching then requires `selectModels` to load new weights — the `modelLoading`/`autoVoiceProfileSync` chain D5 excludes. Functional switching is follow-up work. |
| D5 | **New kiosk-only engine hook**; `LivePage.jsx` is not modified. | `LivePage` backs the live production chatbot and has a history of subtle live-path races. Duplicating the kiosk setup (~250 lines — the initial ~150 estimate was low) is cheaper than risking a regression. Extract later if `gi` becomes the only skin. |
| D6 | **gi-bleeding navy `#181c62` scoped to the gi page root.** | Faithful to the source design without changing the palette of other builds. |

## Architecture

```
App.jsx
  └─ (APP_MODE_CONFIG.showGiChat) ──► GiChatPage.jsx      ← full-bleed, bypasses app shell
                                        │
                                        ├─ components/gi/*  (presentational, props only)
                                        └─ hooks/useGiChatEngine.js
                                             │
                                             └─ useLiveSpeech()  ← UNCHANGED, shared with LivePage
                                                  └─ liveConversation.js → live-gateway → GPT-SoVITS
```

`GiChatPage` is a container: it owns no engine logic, only layout state
(`sidebarOpen`, `mobileView`, footer-height measurement). Every `components/gi/*`
file is pure and prop-driven, so each can be understood and tested without the
engine.

### `hooks/useGiChatEngine.js`

Sole responsibility: assemble the kiosk-path inputs to `useLiveSpeech` and adapt
its return value to the shape the gi components expect.

Inputs assembled from existing modules — `lib/liveFastSetup.js`,
`lib/savedVoiceProfile.js`, `lib/voiceProfiles.js`,
`lib/chatbotSystemPrompt.js`, `lib/chatbotDocuments.js`.

Returned interface (adapter over `useLiveSpeech`):

| Returned key | Source |
|---|---|
| `status` | `phase` (`idle`/`listening`/`thinking`/`speaking`/`error`) |
| `messages` | `messages` (already `{ role, text, … }`) |
| `voiceActive` | `isConversationActive` |
| `responseBusy` | derived from `phase` |
| `error` | `error` |
| `startConversation` / `stopConversation` | `start` / `stop` |
| `micMuted` / `toggleMute` | `isMicInputEnabled` + `enableMicInput`/`disableMicInput` |
| `inputMode` / `setInputMode` | local state |
| `send(text)` | text-mode submit path |
| `voiceOptions` / `selectedVoiceId` / `setSelectedVoiceId` | `buildVoiceProfiles(gptModels, sovitsModels)` over `getModels()`; read-only per D4a |
| `newChat()` | clears `messages` |

Fields with no counterpart (`avatarVideoStream`, `avatarOptions`,
`avatarWarning`, `introLocked`, `avatarDebugInfo`) are removed from the
components rather than stubbed, so no dead props survive the port.

## File Manifest

### New — `client/src/components/gi/`
`ChatHistory.jsx`, `ChatList.jsx`, `ChatMessage.jsx`, `Composer.jsx`,
`AvatarStage.jsx`, `AvatarOrb.jsx`, `DisclaimerBanner.jsx`, `VoicePicker.jsx`

### New — elsewhere
- `client/src/pages/GiChatPage.jsx`
- `client/src/hooks/useGiChatEngine.js`
- `client/src/assets/maleavatar.png`
- `client/.env.gi` (`VITE_APP_MODE=gi`)

### Modified
- `client/src/lib/appMode.js` — add the `gi` mode
- `client/src/App.jsx` — route `/` to `GiChatPage` when `showGiChat`
- `client/tailwind.config.js` — `surface`/`ink`/`ink-muted` colours, `pulse-ring` keyframes + animations
- `client/src/globals.css` — `.gi-root { --primary: 236 61% 24%; }`
- `client/package.json` — `dev:gi` (port 5176), `build:gi` → `dist-gi`

### Not touched
`TrainingPage.jsx`, `InferencePage.jsx`, `LivePage.jsx`, `services/api.js`,
`hooks/useLiveSpeech.js`, `hooks/liveConversation.js`, and all existing build modes.

### Not ported from gi-bleeding
`useChat`, `useRealtimeSession`, `useAvatarSession`, `api/*`, `AvatarPicker`,
`AvatarDiagnostics`, `NotFoundPage`, `config.js`, `lib/chatScope.js`,
`lib/conversationContext.js`, `lib/streamingAudioPlayer.js`, `backend/`.

## Tailwind 4 → 3 Adaptations

The source uses Tailwind 4 (`@import "tailwindcss"` + `@theme`); this project is
on Tailwind 3 with an HSL-triplet shadcn token system.

| Source (TW4) | Adaptation (TW3) |
|---|---|
| `@theme { --color-surface … }` | `theme.extend.colors.surface/ink/ink-muted` in `tailwind.config.js` |
| `bg-surface`, `text-ink`, `text-ink-muted` | unchanged once the colours are registered |
| `backdrop-blur-xs` | `backdrop-blur-sm` (no `xs` in v3) |
| `size-5`, `size-11`, `size-16` | unchanged (supported since v3.4) |
| `color-mix(in oklch, var(--color-primary) 35%, transparent)` | `bg-primary/35` utility |
| `.animate-pulse-ring` / `-fast` in CSS | `keyframes.pulse-ring` + two `animation` entries in config |

`--color-primary: #181c62` becomes `--primary: 237 61% 24%` (HSL triplet, matching
this project's token format) scoped under `.gi-root` on `GiChatPage`'s outermost
element, leaving `:root` untouched for other builds.

## `appMode.js` Changes

Add `'gi'` to `APP_MODES`. `getAppModeConfig('gi')` returns:

```
mode: 'gi', kiosk: true, showGiChat: true,
showTraining: false, showLiveFast: false, showTextToSpeech: false,
navItems: [], defaultPath: '/', subtitle: 'GI Bleeding Chatbot'
```

`showGiChat: false` is added to every other mode's config, so existing modes are
unaffected. This is the mechanism that hides Training and TTS from the gi UI
while their code remains fully present and reachable from other build modes.

**Route-order requirement:** `App.jsx`'s `/` route currently falls through
`showTraining → showLiveFast → Navigate(defaultPath)`. Because `gi` sets all
three flags false and `defaultPath` is `/`, the `showGiChat` branch **must be
evaluated first** in that chain, or the route redirects to itself in a loop.

## Error Handling

- Engine errors surface through `chat.error` in the existing red footer strip,
  passed through `sanitizeBackendError` as `LivePage` already does.
- Mic-permission denial reuses `useLiveSpeech`'s `speechApiAvailable` and
  `notice` and renders in the amber warning strip.
- GPU cold start: `gi` is a non-training mode, so `GPU_AUTO_START` in `App.jsx`
  already covers it and `GpuStartingOverlay` renders above the page unchanged.
- The `AvatarStage` video branch is unreachable without LiveKit; the component is
  simplified to the `AvatarOrb` branch only rather than left with a dead path.

## Testing

Per project convention, client tests use **`node --test`**, not Vitest.

- `client/src/lib/appMode.test.js` — extend with `gi` mode assertions: kiosk true,
  training/TTS/live-fast false, empty nav; and that existing modes now report
  `showGiChat: false`.
- `client/src/hooks/useGiChatEngine.test.js` — pure-function coverage of the
  adapter mappings: `phase → status`, `phase → responseBusy`, and the
  mute-state derivation. Mapping logic is exported as standalone functions so it
  is testable without mounting React.
- Manual verification via `npm run dev:gi`: voice session start/stop, mic mute,
  text mode send, cloned-voice playback, voice-profile switch, New chat clearing
  the transcript, sidebar collapse, and the mobile chat/avatar toggle.
- Regression guard: `npm run build:chatbot` and `npm run build:live-fast` must
  still succeed and be byte-comparable in behaviour, since no file they depend on
  is modified except `appMode.js` (additive) and `tailwind.config.js` (additive).

## Risks

| Risk | Mitigation |
|---|---|
| Duplicated kiosk setup drifts from `LivePage` over time | Documented in `useGiChatEngine.js` header comment pointing at `LivePage.jsx:300-615` as the origin |
| Tailwind token collisions between the gi palette and shadcn tokens | Palette override scoped to `.gi-root`, never `:root` |
| gi components assume Tailwind 4 utility behaviour not caught by the table above | Visual check of every ported component during `dev:gi` verification |
| `messages` shape differs subtly from gi's `ChatList` expectations | `ChatMessage` adapted to this project's message fields as part of the port, not shimmed |
