# Live Gateway TTS Prosody Fix — Design Spec
Date: 2026-06-04

## Problem

In the Live chat, the AI's spoken reply (rendered through the cloned "Trump" GPT-SoVITS
voice) comes out as a non-stop run-on with no pauses. The voice never breathes because
the underlying assistant text arrives with little or no punctuation.

"Trump" is **not** an LLM persona — it is only the cloned *voice*. The LLM is the generic
OpenAI Realtime assistant. So the run-on is a property of the assistant's **text**, not
the voice model.

## Root Cause

1. **Punctuation guidance never reaches production.** The April 30 work added comma/em-dash/
   question-mark guidance to `DEFAULT_SYSTEM_PROMPT` in
   `live-gateway/src/services/openaiRealtimeEvents.js`, but noted "anyone with a custom
   prompt is unaffected." The deployment **does** set a custom `OPENAI_REALTIME_SYSTEM_PROMPT`
   (`live-gateway/.env`, `.env.livegateway.deployment`). `languageOnlyPrompt()` takes that
   custom prompt and only re-appends a *language* instruction — every prosody hint is dropped.
   The model then emits flat, punctuation-sparse text.

2. **Every pause mechanism is punctuation-driven.** The Live page runs in **`phrases` mode**
   (`client/src/App.jsx` → `<LivePage replyMode="phrases" />`). There,
   `splitLiveReplyPhrases()` (`client/src/hooks/liveConversation.js`) splits the reply on
   `.!?;:。！？；：`, synthesizes each phrase separately, and plays them back-to-back with
   each phrase's natural trailing silence between them. With **no punctuation**, the splitter
   returns the entire reply as a **single phrase** → one long non-stop utterance. (Full mode's
   `computeChunkPauses`/`pauseForPunctuation` in `longTextInference.js` is likewise driven by
   trailing punctuation.)

There is a strict dependency: **punctuation must be fixed at the source**; only then does the
existing phrase/pause machinery work. Voice tuning alone cannot insert pauses that aren't there.

## Solution — three layers, in dependency order

### Layer 1 — Source fix: always inject prosody guidance into the system prompt (primary)

Change prompt assembly in `live-gateway/src/services/openaiRealtimeEvents.js` so a fixed
**prosody block is always appended** to whatever prompt is in effect (default *or* custom env),
after the persona text and language instruction.

- Introduce a `PROSODY_GUIDANCE` constant, e.g.:
  > "Write the way it should be spoken aloud. Use short sentences. Use commas for natural
  > rhythm and em dashes — like this — for mid-sentence pauses. End every sentence with a
  > period, question mark, or exclamation mark. Spell out numbers and years as you would say
  > them."
- `languageOnlyPrompt()` returns: `<neutralized persona prompt> <language instruction> <PROSODY_GUIDANCE>`.
- `DEFAULT_SYSTEM_PROMPT` is simplified to drop the now-duplicated inline prosody text (the
  block is always appended regardless), keeping only persona + language behavior.
- The persona/custom prompt text is fully preserved; only the guaranteed prosody block is added.
- **No length cap** is added (per decision — replies are not forced shorter).

This is the change that actually fixes production, because production uses a custom prompt.

### Layer 2 — Safety net: deterministic punctuation fallback (server/gateway-side)

Even with Layer 1, an occasional reply still arrives under-punctuated. Add a conservative
normalizer applied inside `RealtimeEventMapper.preprocessAssistantText()` (i.e. in
`live-gateway/src/services/textPreprocessor.js`, the same place number/abbreviation
normalization already runs for assistant text).

Behavior:
- Operates only when punctuation is genuinely **missing**: if a run of ≥ N words (tunable,
  ~12) contains no sentence-ending punctuation (`.!?`), insert a boundary at the most natural
  point — preferring a coordinating conjunction / discourse marker (and, but, so, because,
  then, also, however) near the midpoint, else a length-based fallback.
- If adequate punctuation already exists, the text is returned unchanged (no double-punctuation,
  no behavior change for the common case).
- Runs **before** the existing `preprocessText` number/abbreviation steps so downstream
  splitting sees the inserted boundaries.
- Because this text is also what the browser displays as the chat bubble, the inserted
  periods improve transcript readability too.

This guarantees the phrase splitter always has cut points, independent of the model.

### Layer 3 — Voice/synthesis tuning: pause polish (light)

Per decision, speech pace is fine — **keep `speed_factor` at 1.0**. Focus only on pause
breathing room:

- Phrases mode (default): optionally add a small, configurable gap (~80–150 ms) between
  sequential phrase-part playback in `client/src/hooks/useLiveSpeech.js`
  (`synthesizePhraseAssistantReply`), so sentence boundaries are clearly audible rather than
  butting up against each other. Default conservative; easy to disable.
- Full mode: no change required (`computeChunkPauses` already sizes pauses by punctuation).

Layer 3 is polish — Layers 1 + 2 do the real work.

## Files Changed

| File | Change |
|---|---|
| `live-gateway/src/services/openaiRealtimeEvents.js` | Always append `PROSODY_GUIDANCE`; simplify `DEFAULT_SYSTEM_PROMPT` |
| `live-gateway/src/services/textPreprocessor.js` | Add `ensureSentenceBoundaries()` fallback; call it first in `preprocessText` (or in `preprocessAssistantText`) |
| `live-gateway/src/services/openaiRealtimeEvents.test.js` | Cover always-appended prosody block (default + custom prompt) |
| `live-gateway/src/services/textPreprocessor` test (new/existing) | Cover punctuation-fallback: inserts on run-on, no-ops on already-punctuated |
| `client/src/hooks/useLiveSpeech.js` | (Optional Layer 3) small configurable inter-phrase playback gap |

## Verification

- Unit: custom env prompt still ends with the prosody block; run-on input gains sentence
  boundaries; already-punctuated input is unchanged.
- Manual: in Live mode, ask a question that previously produced a run-on; confirm the chat
  bubble text now has sentence punctuation and the voice pauses between sentences.

## Out of Scope

- LLM persona changes (Trump persona text) — "Trump" is the voice, not the prompt.
- Forcing shorter replies / length caps.
- Lowering `speed_factor` (pace judged acceptable).
- True SSML, Gemini bridge parity, non-English number formats.
- Reworking full-mode chunk pause logic (already punctuation-aware).
