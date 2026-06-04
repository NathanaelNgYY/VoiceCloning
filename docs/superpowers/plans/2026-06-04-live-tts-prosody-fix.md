# Live Gateway TTS Prosody Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Live chat AI reply with proper sentence punctuation so the cloned voice ("Trump") pauses naturally instead of speaking in one non-stop run-on.

**Architecture:** Two server-side (live-gateway) layers. Layer 1 guarantees the OpenAI Realtime system prompt always carries punctuation/prosody guidance, even when a custom `OPENAI_REALTIME_SYSTEM_PROMPT` is set (the production case). Layer 2 is a deterministic punctuation fallback that inserts sentence boundaries only when a reply arrives genuinely under-punctuated. Voice model, reference audio, and all synthesis sampling params are untouched, so voice similarity is unchanged.

**Tech Stack:** Node.js (ESM), `node:test` test runner, no external deps.

---

## Background (read before starting)

- "Trump" is the cloned **voice** (GPT-SoVITS), not an LLM persona. The LLM is the generic OpenAI Realtime assistant. The run-on is a property of the assistant **text**.
- The Live page runs in **phrases mode** (`client/src/App.jsx` renders `<LivePage replyMode="phrases" />`). `splitLiveReplyPhrases()` splits the reply on `.!?;:` and synthesizes each phrase separately. **No punctuation → one giant phrase → non-stop speech.** So fixing punctuation upstream is what makes pauses appear.
- Assistant text is preprocessed in `live-gateway/src/services/openaiRealtimeEvents.js` → `RealtimeEventMapper.preprocessAssistantText()` → `preprocessText()` in `live-gateway/src/services/textPreprocessor.js`. Chinese (`zh`) skips `preprocessText` entirely, so Layer 2 (English logic) lives inside `preprocessText` and only affects English.

All commands below run from the `live-gateway/` directory unless stated otherwise:

```bash
cd "live-gateway"
```

Test runner: `npm test` runs every `src/**/*.test.js`. To run a single file: `node --test src/services/<file>.test.js`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `live-gateway/src/services/openaiRealtimeEvents.js` | Builds the realtime session prompt; maps events; preprocesses assistant text | Modify (Layer 1) |
| `live-gateway/src/services/openaiRealtimeEvents.test.js` | Tests for prompt assembly + mapping | Modify (Layer 1 tests) |
| `live-gateway/src/services/textPreprocessor.js` | Number/abbreviation/symbol normalization for TTS text | Modify (Layer 2) |
| `live-gateway/src/services/textPreprocessor.test.js` | Tests for text preprocessing | Create (Layer 2 tests) |

---

## Task 1: Layer 1 — always append prosody guidance to the system prompt

**Files:**
- Modify: `live-gateway/src/services/openaiRealtimeEvents.js` (lines 11-12 `DEFAULT_SYSTEM_PROMPT`, lines 24-38 `languageOnlyPrompt`)
- Test: `live-gateway/src/services/openaiRealtimeEvents.test.js`

- [ ] **Step 1: Write the failing tests**

Add these three tests to the end of `live-gateway/src/services/openaiRealtimeEvents.test.js`:

```javascript
test('buildRealtimeSessionUpdate always appends prosody guidance for the default prompt', () => {
  const update = buildRealtimeSessionUpdate({ language: 'en' });
  assert.match(
    update.session.instructions,
    /End every sentence with a period, question mark, or exclamation mark\./,
  );
});

test('buildRealtimeSessionUpdate appends prosody guidance even for a custom prompt that lacks it', () => {
  const update = buildRealtimeSessionUpdate({
    language: 'en',
    systemPrompt: 'You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English.',
  });

  // Custom persona text is preserved
  assert.match(update.session.instructions, /casual, helpful assistant/);
  // Language instruction still present
  assert.match(update.session.instructions, /Always respond only in English/);
  // Prosody guidance was appended
  assert.match(update.session.instructions, /em dashes/);
  assert.match(
    update.session.instructions,
    /End every sentence with a period, question mark, or exclamation mark\./,
  );
});

test('buildRealtimeSessionUpdate appends prosody guidance for the Chinese prompt too', () => {
  const update = buildRealtimeSessionUpdate({ language: 'zh' });
  assert.match(
    update.session.instructions,
    /End every sentence with a period, question mark, or exclamation mark\./,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/services/openaiRealtimeEvents.test.js`
Expected: FAIL — the new assertions for `/End every sentence.../` and `/em dashes/` do not match (current default prompt says "em dashes" but the custom-prompt and the exact-sentence assertions fail).

- [ ] **Step 3: Implement the change**

In `live-gateway/src/services/openaiRealtimeEvents.js`, replace the `DEFAULT_SYSTEM_PROMPT` definition (currently lines 11-12):

```javascript
const DEFAULT_SYSTEM_PROMPT =
  'You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English. Use commas to create natural rhythm in longer sentences, and em dashes — like this — for mid-sentence pauses. Use question marks on genuine questions.';
```

with:

```javascript
const DEFAULT_SYSTEM_PROMPT =
  'You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English.';

// Always appended to whatever prompt is in effect (default or custom env override),
// so the TTS layer always receives punctuated, speakable text. The voice ("Trump")
// is the cloned GPT-SoVITS model — this only shapes the *text*, never the timbre.
const PROSODY_GUIDANCE =
  'Write the way it should be spoken aloud: use short sentences, commas for natural rhythm, and em dashes — like this — for mid-sentence pauses. End every sentence with a period, question mark, or exclamation mark. Spell out numbers and years the way you would say them.';
```

Then update `languageOnlyPrompt` — change its final `return` (currently line 37) from:

```javascript
  return `${basePrompt} ${languageInstruction}`;
```

to:

```javascript
  return `${basePrompt} ${languageInstruction} ${PROSODY_GUIDANCE}`;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/services/openaiRealtimeEvents.test.js`
Expected: PASS — all tests, including the pre-existing Chinese/English ones, pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/openaiRealtimeEvents.js src/services/openaiRealtimeEvents.test.js
git commit -m "fix(live): always append prosody guidance to realtime system prompt"
```

---

## Task 2: Layer 2 — deterministic punctuation fallback for under-punctuated replies

**Files:**
- Modify: `live-gateway/src/services/textPreprocessor.js` (add `ensureSentenceBoundaries`, call it first inside `preprocessText` at line 190)
- Test: `live-gateway/src/services/textPreprocessor.test.js` (create)

- [ ] **Step 1: Write the failing tests**

Create `live-gateway/src/services/textPreprocessor.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSentenceBoundaries, preprocessText } from './textPreprocessor.js';

test('ensureSentenceBoundaries inserts a boundary into a long run-on with no punctuation', () => {
  const input = 'i think the economy is doing great and we are winning so much right now that nobody can believe it';
  const result = ensureSentenceBoundaries(input);
  // A sentence-ending period was inserted somewhere
  assert.ok(result.includes('.'), `expected an inserted period, got: ${result}`);
  // It became more than one sentence
  assert.ok(result.split('.').filter((s) => s.trim()).length >= 2);
});

test('ensureSentenceBoundaries prefers splitting before a conjunction', () => {
  const input = 'we have the best people working on this every single day and they tell me the numbers are incredible';
  const result = ensureSentenceBoundaries(input);
  // The period lands right before "and"
  assert.match(result, /day\.\s+and/i);
});

test('ensureSentenceBoundaries leaves already-punctuated text unchanged', () => {
  const input = 'Hello there. How are you doing today? I am doing just fine, thanks.';
  assert.equal(ensureSentenceBoundaries(input), input);
});

test('ensureSentenceBoundaries leaves a short run-on below threshold unchanged', () => {
  const input = 'we are winning so much';
  assert.equal(ensureSentenceBoundaries(input), input);
});

test('preprocessText punctuates a run-on and still normalizes numbers', () => {
  const input = 'in 2021 we built so many things and people loved every single part of what we were doing together';
  const result = preprocessText(input);
  assert.ok(result.includes('.'), `expected punctuation, got: ${result}`);
  assert.match(result, /twenty twenty-one/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/services/textPreprocessor.test.js`
Expected: FAIL — `ensureSentenceBoundaries` is not exported / not defined.

- [ ] **Step 3: Implement `ensureSentenceBoundaries`**

In `live-gateway/src/services/textPreprocessor.js`, add this block immediately above the `export function preprocessText(text)` definition (currently line 190):

```javascript
// ── Punctuation fallback ──
// When the model returns a long run of words with no sentence-ending punctuation,
// insert a period at the most natural point so downstream phrase-splitting (which
// drives the voice's pauses) always has a boundary. Conservative: if adequate
// punctuation already exists, the text is returned byte-for-byte unchanged.

const BOUNDARY_WORDS = new Set([
  'and', 'but', 'so', 'because', 'then', 'also', 'however',
  'plus', 'though', 'although', 'while', 'which', 'since',
]);

function endsSentence(word) {
  return /[.!?…]["')\]]*$/u.test(word);
}

export function ensureSentenceBoundaries(text, { minRunWords = 12 } = {}) {
  const input = String(text || '');
  if (!input.trim()) return input;

  const words = input.match(/\S+/gu);
  if (!words || words.length < minRunWords) return input;

  let changed = false;
  let wordsSinceEnd = 0;
  let candidate = -1; // index of word after which a period would precede a conjunction

  for (let i = 0; i < words.length; i += 1) {
    wordsSinceEnd += 1;

    if (endsSentence(words[i])) {
      wordsSinceEnd = 0;
      candidate = -1;
      continue;
    }

    const next = words[i + 1];
    if (next && BOUNDARY_WORDS.has(next.toLowerCase().replace(/[^a-z]/gu, ''))) {
      candidate = i;
    }

    if (wordsSinceEnd >= minRunWords) {
      const insertAt = candidate >= 0 ? candidate : i;
      words[insertAt] = `${words[insertAt].replace(/[,;:]+$/u, '')}.`;
      changed = true;
      wordsSinceEnd = i - insertAt;
      candidate = -1;
    }
  }

  return changed ? words.join(' ') : input;
}
```

- [ ] **Step 4: Wire it into `preprocessText`**

In the same file, change the body of `preprocessText` so the fallback runs first. Replace:

```javascript
export function preprocessText(text) {
  let result = text;

  // 0) Number normalisation (years, ordinals, currency, cardinals)
  result = normalizeNumbers(result);
```

with:

```javascript
export function preprocessText(text) {
  // -1) Punctuation fallback — guarantee sentence boundaries before anything else
  let result = ensureSentenceBoundaries(text);

  // 0) Number normalisation (years, ordinals, currency, cardinals)
  result = normalizeNumbers(result);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test src/services/textPreprocessor.test.js`
Expected: PASS — all five tests pass.

- [ ] **Step 6: Run the full live-gateway suite to confirm no regressions**

Run: `npm test`
Expected: PASS — all existing tests (`openaiRealtimeEvents.test.js`, `openaiRealtimeBridge.test.js`, `liveChat.test.js`, etc.) still pass.

- [ ] **Step 7: Commit**

```bash
git add src/services/textPreprocessor.js src/services/textPreprocessor.test.js
git commit -m "fix(live): insert sentence boundaries when assistant text is under-punctuated"
```

---

## Task 3: Manual verification in the Live app

**Files:** none (verification only)

- [ ] **Step 1: Run the gateway and client, exercise Live mode**

Start the live-gateway, server, and client per the project README/CLAUDE.md. Open Live mode and ask a question that previously produced a run-on (e.g. "tell me why you think the economy is doing well").

- [ ] **Step 2: Confirm the fix**

Expected:
- The assistant chat bubble text now shows sentence punctuation (periods/question marks).
- The voice pauses between sentences instead of speaking non-stop.
- The voice timbre/character is unchanged (same reference audio + weights + sampling params).

If pauses still feel too tight, see "Deferred" below — but per the agreed priority (missing pauses, not pace), Layers 1 + 2 are expected to resolve it.

---

## Deferred (assess by ear only if needed)

**Layer 3 — inter-phrase playback gap (optional polish).** In phrases mode each phrase is a separate WAV with its own natural trailing silence, played sequentially, so sentence pauses appear for free once Layer 1 produces punctuation. If, after manual testing, sentence gaps still feel too tight, add a small configurable delay (~80–150 ms) when advancing between phrase parts in the client playback path (`client/src/hooks/useLiveSpeech.js` / `LivePage.jsx`). Keep `speed_factor` at 1.0 (pace was judged fine). This is intentionally not implemented up front to avoid touching playback orchestration without evidence it's needed.

---

## Self-Review Notes

- **Spec coverage:** Layer 1 → Task 1. Layer 2 → Task 2. Layer 3 → Deferred (spec marked it optional; user prioritized pauses, solved by Layers 1+2). Verification → Task 3.
- **No length cap** added and **`speed_factor` untouched**, per decisions.
- **Voice similarity unaffected:** no change to reference audio, weights, or sampling params — only text and (deferred) silence.
