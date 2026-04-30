# Chatbot TTS Naturalness — Design Spec
Date: 2026-04-30

## Problem

The live chatbot voice sounds unnatural in two specific ways:

1. **Number/year mispronunciation** — digits like "2021" are passed raw to GPT-SoVITS, which reads them as "two thousand twenty-first" instead of "twenty twenty-one".
2. **Flat intonation** — the LLM produces flat, comma-light sentences; GPT-SoVITS uses punctuation as its main prosody guide, so flat text → flat voice.

## Root Cause

The live chatbot bypasses `longTextInference.js` entirely. Both live TTS endpoints (`POST /api/inference` for full mode, `POST /api/live/tts-sentence` for phrases mode) pass raw text straight to GPT-SoVITS. The server already has a solid `preprocessText` function that handles abbreviations, acronyms, and symbols — the chatbot just never calls it.

## Solution

Three changes, all server-side:

### 1. Number normalization in `preprocessText`

Add a `normalizeNumbers(text)` function to `server/src/services/longTextInference.js` and call it as the first step inside `preprocessText`.

Rules (applied in priority order via regex):

| Input | Output |
|---|---|
| Years 1000–2099 in natural context | `2021 → twenty twenty-one`, `2000 → two thousand`, `1999 → nineteen ninety-nine` |
| Ordinals | `1st → first`, `2nd → second`, `21st → twenty-first` |
| Currency (USD) | `$50 → fifty dollars`, `$3.50 → three dollars and fifty cents` |
| Decimals | `3.14 → three point one four` |
| Plain cardinals | `42 → forty-two`, `1,500 → fifteen hundred` |
| Safe fallback | Unrecognised patterns are left unchanged (model IDs, version numbers, etc.) |

All rule-based regex — no new npm dependency.

Year detection: a 4-digit number is treated as a year when it is standalone, follows words like "in", "since", "from", "of", "until", or appears at end of sentence. Otherwise treated as a plain cardinal.

### 2. Wire `preprocessText` into live TTS endpoints

Call `preprocessText(params.text)` on the incoming `text` field in both route handlers before the text reaches GPT-SoVITS:

- `server/src/routes/inference.js` — the `POST /inference` handler (used by chatbot full mode)
- The handler for `POST /live/tts-sentence` (used by chatbot phrases mode)

One-line change each. The chatbot immediately gains abbreviation expansion, acronym spacing, symbol expansion, compound-word splitting, and the new number normalization.

### 3. Update the default OpenAI system prompt

Append TTS-friendly guidance to `DEFAULT_SYSTEM_PROMPT` in `server/src/services/openaiRealtimeEvents.js`:

- Use commas to create natural breathing rhythm in longer sentences
- Use em dashes (—) for mid-sentence dramatic pauses
- Spell out numbers and years as you would say them aloud
- Use question marks on genuine questions

The prompt is env-overridable via `OPENAI_REALTIME_SYSTEM_PROMPT`, so anyone with a custom prompt is unaffected.

## Files Changed

| File | Change |
|---|---|
| `server/src/services/longTextInference.js` | Add `normalizeNumbers`, call it inside `preprocessText` |
| `server/src/routes/inference.js` | Call `preprocessText` before forwarding text to GPT-SoVITS |
| `server/src/routes/liveChat.js` (or wherever `/live/tts-sentence` lives) | Call `preprocessText` before forwarding text |
| `server/src/services/openaiRealtimeEvents.js` | Update `DEFAULT_SYSTEM_PROMPT` |

## Out of Scope

- True SSML parsing (GPT-SoVITS doesn't support it)
- Pause injection between phrases (handled sufficiently by existing `computeChunkPauses` logic)
- Non-English number formats
- Client-side changes
