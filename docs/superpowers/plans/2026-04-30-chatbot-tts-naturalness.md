# Chatbot TTS Naturalness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix year/number mispronunciation and improve intonation in the live chatbot voice output by extending the existing text preprocessing pipeline and wiring it into the live TTS endpoints.

**Architecture:** Add a `normalizeNumbers` helper to the existing `preprocessText` function in `longTextInference.js`, export `preprocessText`, call it in the `/live/tts-sentence` route handler (which currently bypasses all preprocessing), and update the default OpenAI system prompt to encourage natural punctuation. The `/inference` POST endpoint already goes through `synthesizeLongText` → `splitIntoSentences` → `preprocessText`, so it gets the number normalization for free once it's added there.

**Tech Stack:** Node.js ESM, `node:test` + `node:assert/strict` for tests, no new dependencies.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server/src/services/longTextInference.js` | Modify | Add `normalizeNumbers`, call it in `preprocessText`, export both |
| `server/src/services/longTextInference.test.js` | Create | Unit tests for `normalizeNumbers` and `preprocessText` |
| `server/src/routes/inference.js` | Modify | Import `preprocessText`, apply it in `/live/tts-sentence` handler |
| `server/src/services/openaiRealtimeEvents.js` | Modify | Update `DEFAULT_SYSTEM_PROMPT` with TTS punctuation guidance |
| `server/src/services/openaiRealtimeEvents.test.js` | Modify | Update test assertions for new prompt content |
| `server/package.json` | Modify | Add `test:normalization` script |

---

## Task 1: Number normalization helpers

**Files:**
- Modify: `server/src/services/longTextInference.js`
- Create: `server/src/services/longTextInference.test.js`

- [ ] **Step 1: Create the test file with failing tests**

Create `server/src/services/longTextInference.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocessText } from './longTextInference.js';

// Years
test('preprocessText: year 2021 -> twenty twenty-one', () => {
  assert.equal(preprocessText('released in 2021'), 'released in twenty twenty-one');
});
test('preprocessText: year 2000 -> two thousand', () => {
  assert.equal(preprocessText('the year 2000'), 'the year two thousand');
});
test('preprocessText: year 1999 -> nineteen ninety-nine', () => {
  assert.equal(preprocessText('back in 1999'), 'back in nineteen ninety-nine');
});
test('preprocessText: year 2001 -> two thousand and one', () => {
  assert.equal(preprocessText('since 2001'), 'since two thousand and one');
});
test('preprocessText: year 2010 -> twenty ten', () => {
  assert.equal(preprocessText('from 2010'), 'from twenty ten');
});
test('preprocessText: year 1776 -> seventeen seventy-six', () => {
  assert.equal(preprocessText('in 1776'), 'in seventeen seventy-six');
});

// Ordinals
test('preprocessText: 1st -> first', () => {
  assert.equal(preprocessText('the 1st place'), 'the first place');
});
test('preprocessText: 2nd -> second', () => {
  assert.equal(preprocessText('2nd and 3rd'), 'second and third');
});
test('preprocessText: 21st -> twenty-first', () => {
  assert.equal(preprocessText('the 21st century'), 'the twenty-first century');
});
test('preprocessText: 30th -> thirtieth', () => {
  assert.equal(preprocessText('the 30th anniversary'), 'the thirtieth anniversary');
});

// Currency
test('preprocessText: $50 -> fifty dollars', () => {
  assert.equal(preprocessText('costs $50'), 'costs fifty dollars');
});
test('preprocessText: $1 -> one dollar', () => {
  assert.equal(preprocessText('just $1'), 'just one dollar');
});
test('preprocessText: $3.50 -> three dollars and fifty cents', () => {
  assert.equal(preprocessText('fee is $3.50'), 'fee is three dollars and fifty cents');
});

// Decimals
test('preprocessText: 3.14 -> three point one four', () => {
  assert.equal(preprocessText('pi is 3.14'), 'pi is three point one four');
});
test('preprocessText: 0.5 -> zero point five', () => {
  assert.equal(preprocessText('chance of 0.5'), 'chance of zero point five');
});

// Cardinals
test('preprocessText: small cardinals', () => {
  assert.equal(preprocessText('I have 3 cats and 42 dogs'), 'I have three cats and forty-two dogs');
});
test('preprocessText: hundreds', () => {
  assert.equal(preprocessText('over 100 people'), 'over one hundred people');
});
test('preprocessText: comma-separated thousands', () => {
  assert.equal(preprocessText('about 1,500 users'), 'about fifteen hundred users');
});
```

- [ ] **Step 2: Add `test:normalization` script to package.json**

In `server/package.json`, add to the `"scripts"` block:

```json
"test:normalization": "node --test src/services/longTextInference.test.js"
```

- [ ] **Step 3: Run tests to confirm they all fail**

```bash
cd server && npm run test:normalization
```

Expected: all tests fail with `SyntaxError` or `Error [ERR_MODULE_NOT_FOUND]` — `preprocessText` is not exported yet.

- [ ] **Step 4: Add number-words lookup tables to `longTextInference.js`**

Open `server/src/services/longTextInference.js`. Add the following block **immediately before** the `const DEFAULT_SYSTEM_PROMPT` line (or at the top of the file after the existing `const DEFAULTS = {...}` block — pick a logical spot above the first function definition):

```js
// ── Number-to-words helpers ──

const NUM_ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const NUM_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const NUM_ORDINAL_ONES = [
  '', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth',
  'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth',
  'seventeenth', 'eighteenth', 'nineteenth',
];
const NUM_ORDINAL_TENS = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];

function twoDigitWords(n) {
  if (n < 20) return NUM_ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? NUM_TENS[t] : `${NUM_TENS[t]}-${NUM_ONES[o]}`;
}

function cardinalWords(n) {
  if (n === 0) return 'zero';
  if (n < 20) return NUM_ONES[n];
  if (n < 100) return twoDigitWords(n);
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    const base = `${NUM_ONES[h]} hundred`;
    return r === 0 ? base : `${base} and ${twoDigitWords(r)}`;
  }
  if (n < 1000000) {
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    const base = `${cardinalWords(th)} thousand`;
    if (r === 0) return base;
    if (r < 100) return `${base} and ${cardinalWords(r)}`;
    return `${base} ${cardinalWords(r)}`;
  }
  return String(n);
}

function ordinalWords(n) {
  if (n < 20) return NUM_ORDINAL_ONES[n] || `${cardinalWords(n)}th`;
  if (n < 100) {
    if (n % 10 === 0) return NUM_ORDINAL_TENS[Math.floor(n / 10)];
    return `${NUM_TENS[Math.floor(n / 10)]}-${NUM_ORDINAL_ONES[n % 10]}`;
  }
  return `${cardinalWords(n)}th`;
}

function yearWords(n) {
  if (n === 2000) return 'two thousand';
  if (n >= 2001 && n <= 2009) return `two thousand and ${NUM_ONES[n % 10]}`;
  if (n >= 2010) return `twenty ${twoDigitWords(n - 2000)}`;
  const high = Math.floor(n / 100);
  const low = n % 100;
  if (low === 0) return `${twoDigitWords(high)} hundred`;
  return `${twoDigitWords(high)} ${twoDigitWords(low)}`;
}

function currencyWords(amountStr) {
  const cleaned = amountStr.replace(/,/g, '');
  const [intPart, decPart = '0'] = cleaned.split('.');
  const dollars = parseInt(intPart, 10) || 0;
  const cents = parseInt(decPart.padEnd(2, '0').slice(0, 2), 10);
  const dollarWord = dollars === 1 ? 'dollar' : 'dollars';
  const centWord = cents === 1 ? 'cent' : 'cents';
  if (cents === 0) return `${cardinalWords(dollars)} ${dollarWord}`;
  if (dollars === 0) return `${cardinalWords(cents)} ${centWord}`;
  return `${cardinalWords(dollars)} ${dollarWord} and ${cardinalWords(cents)} ${centWord}`;
}

export function normalizeNumbers(text) {
  let result = text;

  // 1. Ordinals: 1st, 2nd, 3rd … 21st, 22nd …
  result = result.replace(/\b(\d{1,3})(st|nd|rd|th)\b/gi, (_, n) => ordinalWords(parseInt(n, 10)));

  // 2. Currency: $50, $3.50, $1,500
  result = result.replace(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\b/g, (_, amount) => currencyWords(amount));

  // 3. Decimal numbers: 3.14, 0.5 (must run before year/cardinal steps)
  result = result.replace(/\b(\d+)\.(\d+)\b/g, (_, int, dec) =>
    `${cardinalWords(parseInt(int, 10))} point ${dec.split('').map(d => NUM_ONES[parseInt(d, 10)] || d).join(' ')}`
  );

  // 4. Years 1000–2099 (standalone 4-digit numbers in that range)
  result = result.replace(/\b(1[0-9]{3}|20[0-9]{2})\b/g, (_, yr) => yearWords(parseInt(yr, 10)));

  // 5. Comma-separated numbers: 1,500 / 10,000
  result = result.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (_, n) =>
    cardinalWords(parseInt(n.replace(/,/g, ''), 10))
  );

  // 6. Remaining plain integers up to 4 digits
  result = result.replace(/\b(\d{1,4})\b/g, (_, n) => cardinalWords(parseInt(n, 10)));

  return result;
}
```

- [ ] **Step 5: Call `normalizeNumbers` as step 0 inside `preprocessText`, and export `preprocessText`**

Find the existing `preprocessText` function (around line 211):

```js
function preprocessText(text) {
  let result = text;

  // 1) Abbreviation expansion
```

Replace it with:

```js
export function preprocessText(text) {
  let result = text;

  // 0) Number normalisation (years, ordinals, currency, cardinals)
  result = normalizeNumbers(result);

  // 1) Abbreviation expansion
```

(Leave the rest of the function body unchanged.)

- [ ] **Step 6: Run tests and confirm they pass**

```bash
cd server && npm run test:normalization
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
cd server && git add src/services/longTextInference.js src/services/longTextInference.test.js package.json
git commit -m "feat: add number normalization to TTS text preprocessor"
```

---

## Task 2: Wire `preprocessText` into the `/live/tts-sentence` route

**Files:**
- Modify: `server/src/routes/inference.js`

- [ ] **Step 1: Add the import**

Open `server/src/routes/inference.js`. Find the existing import line that already brings in things from `longTextInference.js`:

```js
import { synthesizeLongText, synthesizeLongTextStreaming, cancelSession, getSessionFinalPath, getSessionChunkPath } from '../services/longTextInference.js';
```

Add `preprocessText` to it:

```js
import { synthesizeLongText, synthesizeLongTextStreaming, cancelSession, getSessionFinalPath, getSessionChunkPath, preprocessText } from '../services/longTextInference.js';
```

- [ ] **Step 2: Apply `preprocessText` in the `/live/tts-sentence` handler**

Find the handler body at line 663 (after the `resolveRefAudioPaths` call):

```js
  try {
    const resolved = await resolveRefAudioPaths(ref_audio_path, aux_ref_audio_paths);
    const audioBuffer = await inferenceServer.synthesize({
      text: `${text.trim()} `,
```

Replace the `text:` line with:

```js
  try {
    const resolved = await resolveRefAudioPaths(ref_audio_path, aux_ref_audio_paths);
    const processedText = preprocessText(text.trim());
    const audioBuffer = await inferenceServer.synthesize({
      text: `${processedText} `,
```

(Everything else in the handler stays the same.)

- [ ] **Step 3: Verify the server starts without errors**

```bash
cd server && node src/index.js
```

Expected: server starts on port 3000 with no import errors. `Ctrl+C` to stop.

- [ ] **Step 4: Commit**

```bash
cd server && git add src/routes/inference.js
git commit -m "feat: apply text preprocessing in live tts-sentence route"
```

---

## Task 3: Update the default system prompt for TTS-friendly intonation

**Files:**
- Modify: `server/src/services/openaiRealtimeEvents.js`
- Modify: `server/src/services/openaiRealtimeEvents.test.js`

- [ ] **Step 1: Read the existing test that checks the prompt**

Open `server/src/services/openaiRealtimeEvents.test.js` and find the test that asserts on `session.instructions`. It currently expects:

```
'You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English.'
```

(or similar — the exact string is what `englishOnlyPrompt(DEFAULT_SYSTEM_PROMPT)` produces).

- [ ] **Step 2: Update `DEFAULT_SYSTEM_PROMPT` in `openaiRealtimeEvents.js`**

Find (around line 1):

```js
const DEFAULT_SYSTEM_PROMPT =
  'You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English.';
```

Replace with:

```js
const DEFAULT_SYSTEM_PROMPT =
  'You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English. Use commas to create natural rhythm in longer sentences, and em dashes — like this — for mid-sentence pauses. Use question marks on genuine questions.';
```

- [ ] **Step 3: Update the test that asserts on the default instructions**

In `server/src/services/openaiRealtimeEvents.test.js`, find the test that checks `message.session.instructions` when using the default prompt. Update the expected string to match the new default after `englishOnlyPrompt` wraps it.

The `englishOnlyPrompt` function returns the prompt unchanged if it already contains "only in English" (which the new prompt does). So the expected value in the test is exactly the new `DEFAULT_SYSTEM_PROMPT` string:

```js
assert.equal(
  message.session.instructions,
  'You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English. Use commas to create natural rhythm in longer sentences, and em dashes — like this — for mid-sentence pauses. Use question marks on genuine questions.'
);
```

- [ ] **Step 4: Run the existing live-chat test suite to confirm all tests pass**

```bash
cd server && npm run test:live-chat
```

Expected: all tests pass. If any fail, they will point to an assertion that still uses the old prompt string — update those assertions to use the new prompt.

- [ ] **Step 5: Commit**

```bash
cd server && git add src/services/openaiRealtimeEvents.js src/services/openaiRealtimeEvents.test.js
git commit -m "feat: update system prompt for TTS-friendly intonation"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Number/year normalization: Task 1 (`normalizeNumbers` + `preprocessText`)
- ✅ Wire preprocessing into live TTS: Task 2 (`/live/tts-sentence`)
- ✅ Full mode chatbot already covered: `/inference` → `synthesizeLongText` → `preprocessText` (inherits Task 1's normalizeNumbers automatically)
- ✅ System prompt for intonation: Task 3
- ✅ No client-side changes needed (spec: out of scope)

**Placeholder scan:** No TBDs. All code blocks are complete.

**Type consistency:** `preprocessText` is exported in Task 1 and imported by name in Task 2. `normalizeNumbers` is called inside `preprocessText` and exported for testing. `cardinalWords`, `ordinalWords`, `yearWords`, `currencyWords`, `twoDigitWords` are all defined before use within the same file.
