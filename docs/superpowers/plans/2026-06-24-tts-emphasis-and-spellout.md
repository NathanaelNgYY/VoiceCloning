# TTS Emphasis & Acronym Spell-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let TTS authors emphasize words by typing them in ALL-CAPS and spell out acronyms via periods/spaces or auto-detection, by transforming the text before it reaches GPT-SoVITS.

**Architecture:** A new pure-string preprocessing module (`emphasisAndSpelling.js`) is inserted into the inference text pipeline between the runtime-dictionary step and normalization. It classifies each word as plain / spell-out / emphasis using an acronym override list plus the CMU dictionary GPT-SoVITS itself uses (real-word check), then renders spell-outs as spaced letters and emphasis as pause-bracketed words. The old blanket caps→acronym split is removed from `textPronunciation.js`.

**Tech Stack:** Node.js ESM, `node:test` runner, `node:assert/strict`. No new dependencies.

## Global Constraints

- ES modules only (`import`/`export`), matching the package's `"type": "module"`.
- Tests are colocated `*.test.js` using `node:test` + `node:assert/strict`, run with `node --test <file>` from the `gpu-inference-worker/` directory.
- No new npm dependencies.
- All transforms are pure string→string and MUST NOT throw on malformed input (unknown tokens pass through unchanged).
- The CMU real-word check MUST degrade gracefully: if the dictionary file cannot be read, treat every word as "not a real word" (so bare caps not in the override list spell out).
- Spell-out rendering preserves the proven existing format: uppercase letters separated by single spaces (e.g. `W H O`), so acronyms sound exactly as they do in production today.
- Emphasis is prosodic only (pause-bracketing) — never audio edits, never per-word re-synthesis.

---

### Task 1: CMU dictionary real-word oracle

**Files:**
- Create: `gpu-inference-worker/src/services/cmuDictionary.js`
- Test: `gpu-inference-worker/src/services/cmuDictionary.test.js`

**Interfaces:**
- Consumes: `GPT_SOVITS_ROOT` from `../config.js`.
- Produces:
  - `loadCmuWordSet(root?: string) => Set<string>` — uppercase words from the dict, empty Set on any failure.
  - `isRealWord(word: string, opts?: { root?: string }) => boolean` — cached lookup.
  - `_resetCmuCacheForTests() => void` — clears the module cache for test isolation.

- [ ] **Step 1: Write the failing test**

Create `gpu-inference-worker/src/services/cmuDictionary.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadCmuWordSet, isRealWord, _resetCmuCacheForTests } from './cmuDictionary.js';

function writeDict(contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmu-'));
  const dir = path.join(root, 'GPT_SoVITS', 'text');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cmudict.rep'), contents);
  return root;
}

test('loadCmuWordSet parses leading words and strips variant markers', () => {
  const root = writeDict('REALLY R IH1 L IY0\nREALLY(1) R IY1 L IY0\nSTOP S T AA1 P\n');
  const set = loadCmuWordSet(root);
  assert.ok(set.has('REALLY'));
  assert.ok(set.has('STOP'));
  assert.equal(set.has('ECG'), false);
});

test('loadCmuWordSet returns an empty set when the dictionary is missing', () => {
  const set = loadCmuWordSet(path.join(os.tmpdir(), 'cmu-does-not-exist-xyz'));
  assert.equal(set.size, 0);
});

test('isRealWord degrades to false when the dictionary cannot be found', () => {
  _resetCmuCacheForTests();
  assert.equal(isRealWord('REALLY', { root: path.join(os.tmpdir(), 'cmu-nope-xyz') }), false);
  _resetCmuCacheForTests();
});

test('isRealWord returns true for a word present in the dictionary', () => {
  _resetCmuCacheForTests();
  const root = writeDict('REALLY R IH1 L IY0\nSTOP S T AA1 P\n');
  assert.equal(isRealWord('really', { root }), true);
  assert.equal(isRealWord('ECG', { root }), false);
  _resetCmuCacheForTests();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gpu-inference-worker && node --test src/services/cmuDictionary.test.js`
Expected: FAIL — `Cannot find module './cmuDictionary.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `gpu-inference-worker/src/services/cmuDictionary.js`:

```js
import fs from 'fs';
import path from 'path';
import { GPT_SOVITS_ROOT } from '../config.js';

// GPT-SoVITS ships the CMU dictionary under GPT_SoVITS/text/. Different builds
// name it differently, so try the known candidates in order.
const CANDIDATE_FILES = ['cmudict.rep', 'cmudict-fast.rep', 'cmudict'];

let cache = null; // Set<string> of uppercase words, populated lazily.

export function loadCmuWordSet(root = GPT_SOVITS_ROOT) {
  const words = new Set();
  if (!root) return words;
  const dir = path.join(root, 'GPT_SoVITS', 'text');
  for (const name of CANDIDATE_FILES) {
    const file = path.join(dir, name);
    try {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf-8');
      for (const line of content.split(/\r?\n/u)) {
        const token = line.trim().split(/\s+/u)[0];
        if (token) words.add(token.toUpperCase().replace(/\(\d+\)$/u, ''));
      }
      break;
    } catch {
      // Try the next candidate; never throw from a real-word check.
    }
  }
  return words;
}

export function isRealWord(word, { root } = {}) {
  if (cache === null) {
    try {
      cache = loadCmuWordSet(root);
    } catch {
      cache = new Set();
    }
  }
  return cache.has(String(word || '').toUpperCase());
}

export function _resetCmuCacheForTests() {
  cache = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gpu-inference-worker && node --test src/services/cmuDictionary.test.js`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add gpu-inference-worker/src/services/cmuDictionary.js gpu-inference-worker/src/services/cmuDictionary.test.js
git commit -m "feat(inference): add CMU dictionary real-word oracle with graceful fallback"
```

---

### Task 2: Emphasis & spell-out transform

**Files:**
- Create: `gpu-inference-worker/src/services/acronymOverrides.js`
- Create: `gpu-inference-worker/src/services/emphasisAndSpelling.js`
- Test: `gpu-inference-worker/src/services/emphasisAndSpelling.test.js`

**Interfaces:**
- Consumes: `isRealWord` from `./cmuDictionary.js` (Task 1); `ACRONYM_OVERRIDES` from `./acronymOverrides.js`.
- Produces:
  - `classifyWord(word, opts?) => 'plain' | 'spellout' | 'emphasis'`
  - `renderSpellout(letters: string) => string`
  - `renderEmphasis(word: string) => string`
  - `applyEmphasisAndSpelling(text: string, opts?: { acronyms?: Set<string>, isRealWord?: (w:string)=>boolean }) => string`

- [ ] **Step 1: Write the failing test**

Create `gpu-inference-worker/src/services/emphasisAndSpelling.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEmphasisAndSpelling, classifyWord } from './emphasisAndSpelling.js';

// Deterministic stubs so tests don't depend on a CMU file on disk.
const acronyms = new Set(['WHO']);
const realWords = new Set(['REALLY', 'STOP', 'WHO', 'IMPORTANT', 'ORDER', 'AN', 'NOW', 'THE', 'IS', 'THIS']);
const isRealWord = (w) => realWords.has(String(w).toUpperCase());
const opts = { acronyms, isRealWord };

test('dotted acronyms are spelled out', () => {
  const result = applyEmphasisAndSpelling('the W.H.O. guidelines', opts);
  assert.match(result, /W H O/u);
  assert.doesNotMatch(result, /W\.H\.O\./u);
});

test('space-separated single capitals are spelled out', () => {
  const result = applyEmphasisAndSpelling('order an E C G now', opts);
  assert.match(result, /E C G/u);
});

test('bare caps in the override list are spelled out', () => {
  const result = applyEmphasisAndSpelling('the WHO recommends', opts);
  assert.match(result, /W H O/u);
});

test('bare caps that are not real words are spelled out', () => {
  const result = applyEmphasisAndSpelling('order an ECG now', opts);
  assert.match(result, /E C G/u);
});

test('bare caps that are real words become emphasis (pause-bracketed, lowercased)', () => {
  const result = applyEmphasisAndSpelling('this is REALLY important', opts);
  assert.match(result, /,\s*really\s*,/u);
  assert.doesNotMatch(result, /REALLY/u);
});

test('lowercase words are left unchanged', () => {
  const result = applyEmphasisAndSpelling('who is the patient', opts);
  assert.equal(result, 'who is the patient');
});

test('lowercase abbreviations like e.g. are not spelled out', () => {
  const result = applyEmphasisAndSpelling('see e.g. the chart', opts);
  assert.match(result, /e\.g\./u);
});

test('a sentence mixing all cases', () => {
  const result = applyEmphasisAndSpelling('The WHO says this is REALLY urgent; order an ECG.', opts);
  assert.match(result, /W H O/u);
  assert.match(result, /,\s*really\s*,/u);
  assert.match(result, /E C G/u);
});

test('emphasis next to terminal punctuation does not leave a dangling comma', () => {
  const result = applyEmphasisAndSpelling('just STOP!', opts);
  assert.match(result, /stop!/u);
  assert.doesNotMatch(result, /,\s*!/u);
});

test('classifyWord distinguishes the three intents', () => {
  assert.equal(classifyWord('REALLY', opts), 'emphasis');
  assert.equal(classifyWord('ECG', opts), 'spellout');
  assert.equal(classifyWord('WHO', opts), 'spellout');
  assert.equal(classifyWord('who', opts), 'plain');
  assert.equal(classifyWord('A', opts), 'plain');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gpu-inference-worker && node --test src/services/emphasisAndSpelling.test.js`
Expected: FAIL — `Cannot find module './emphasisAndSpelling.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `gpu-inference-worker/src/services/acronymOverrides.js`:

```js
// Words that are BOTH a real English word AND an acronym. The CMU real-word check
// alone would mis-classify these as emphasis, so they are forced to spell out.
// List ONLY these collisions — pure acronyms (ECG, MRI, COPD, ICU) are detected
// automatically by the not-a-real-word rule and need no entry here.
export const ACRONYM_OVERRIDES = new Set([
  'WHO',   // World Health Organization (vs. the word "who")
  'AIDS',  // acquired immunodeficiency syndrome (vs. the word "aids")
  'US',    // ultrasound / United States (vs. the word "us")
]);
```

Create `gpu-inference-worker/src/services/emphasisAndSpelling.js`:

```js
import { ACRONYM_OVERRIDES } from './acronymOverrides.js';
import { isRealWord as defaultIsRealWord } from './cmuDictionary.js';

// Spell-out renders as uppercase letters separated by single spaces, matching the
// format GPT-SoVITS already pronounces correctly in production today.
export function renderSpellout(letters) {
  return String(letters).replace(/[^A-Za-z]/gu, '').toUpperCase().split('').join(' ');
}

// Emphasis is purely prosodic: bracket the (lowercased) word with comma pauses so
// the model sets it apart. The caps were just an authoring marker.
export function renderEmphasis(word) {
  return `, ${String(word).toLowerCase()},`;
}

export function classifyWord(word, { acronyms = ACRONYM_OVERRIDES, isRealWord = defaultIsRealWord } = {}) {
  if (!word || word.length < 2) return 'plain';
  if (!/^[A-Z]+$/u.test(word)) return 'plain';      // must be bare ALL-CAPS letters
  const upper = word.toUpperCase();
  if (acronyms.has(upper)) return 'spellout';
  if (!isRealWord(word)) return 'spellout';
  return 'emphasis';
}

export function applyEmphasisAndSpelling(text, options = {}) {
  let result = String(text || '');

  // 1. Explicit dotted spell-out, uppercase only so lowercase abbreviations
  //    (e.g., i.e., a.m.) are left untouched: W.H.O.  E.C.G.  U.S.A.
  result = result.replace(/\b([A-Z](?:\.[A-Z])+\.?)/gu, (m) => renderSpellout(m));

  // 2. Explicit space-separated single capitals: W H O  E C G
  result = result.replace(/\b([A-Z](?:\s+[A-Z])+)\b/gu, (m) => renderSpellout(m));

  // 3. Bare alphabetic words: emphasis vs. auto spell-out vs. plain.
  result = result.replace(/[A-Za-z]+/gu, (word) => {
    const kind = classifyWord(word, options);
    if (kind === 'spellout') return renderSpellout(word);
    if (kind === 'emphasis') return renderEmphasis(word);
    return word;
  });

  // 4. Clean up pause-punctuation artifacts introduced by emphasis bracketing.
  result = result
    .replace(/\s+,/gu, ',')              // space before comma
    .replace(/,\s*,/gu, ',')             // doubled commas
    .replace(/,(\s*[.!?;:])/gu, '$1')    // comma glued to terminal/clause punctuation
    .replace(/(^|[.!?]\s*),\s*/gu, '$1') // comma right after a sentence start
    .replace(/[ \t]{2,}/gu, ' ');

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gpu-inference-worker && node --test src/services/emphasisAndSpelling.test.js`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add gpu-inference-worker/src/services/acronymOverrides.js gpu-inference-worker/src/services/emphasisAndSpelling.js gpu-inference-worker/src/services/emphasisAndSpelling.test.js
git commit -m "feat(inference): add caps-emphasis and acronym spell-out transform"
```

---

### Task 3: Remove the blanket caps→acronym split from normalization

**Files:**
- Modify: `gpu-inference-worker/src/services/textPronunciation.js` (remove `ACRONYM_SKIP` set at lines 152-156 and the caps-split block at lines 221-224)
- Modify: `gpu-inference-worker/src/services/textPronunciation.test.js:35-41` (the ATP expectation)

**Interfaces:**
- Consumes: nothing new.
- Produces: `prepareTextForSynthesis` keeps the same signature but no longer splits bare ALL-CAPS tokens (that responsibility now lives in `emphasisAndSpelling.js`).

- [ ] **Step 1: Update the failing test first**

In `gpu-inference-worker/src/services/textPronunciation.test.js`, replace the test at lines 35-41 with one that reflects the moved responsibility (bare caps are no longer split here):

```js
test('prepareTextForSynthesis expands slash abbreviations and removes spoken punctuation dashes', () => {
  const result = prepareTextForSynthesis('Use ref. w/ enzyme - not w/o ATP; input/output matters.');

  assert.match(result, /reference with enzyme, not without ATP/u);
  assert.match(result, /input or out put/u);
  assert.doesNotMatch(result, /[-–—]/u);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gpu-inference-worker && node --test src/services/textPronunciation.test.js`
Expected: FAIL — current code still splits `ATP` into `A T P`, so `/not without ATP/` does not match.

- [ ] **Step 3: Remove the caps-split logic**

In `gpu-inference-worker/src/services/textPronunciation.js`, delete the `ACRONYM_SKIP` declaration (lines 152-156):

```js
const ACRONYM_SKIP = new Set([
  'I', 'A', 'AM', 'PM', 'OK', 'OH', 'OR', 'IF', 'IN', 'IT', 'IS',
  'AT', 'AN', 'AS', 'BE', 'BY', 'DO', 'GO', 'HE', 'ME', 'MY', 'NO',
  'OF', 'ON', 'SO', 'TO', 'UP', 'US', 'WE',
]);
```

And delete the caps-split block inside `prepareTextForSynthesis` (lines 221-224):

```js
  result = result.replace(/\b([A-Z]{2,5})\b/g, (match) => {
    if (ACRONYM_SKIP.has(match)) return match;
    return match.split('').join(' ');
  });
```

Leave everything else (symbol map, abbreviations, compound splits, Unicode cleanup) untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gpu-inference-worker && node --test src/services/textPronunciation.test.js`
Expected: PASS — all 4 tests pass (the updated ATP test plus the three unchanged ones).

- [ ] **Step 5: Commit**

```bash
git add gpu-inference-worker/src/services/textPronunciation.js gpu-inference-worker/src/services/textPronunciation.test.js
git commit -m "refactor(inference): move acronym spell-out out of normalization"
```

---

### Task 4: Wire the transform into all synthesis paths

**Files:**
- Modify: `gpu-inference-worker/src/routes/inference.js` (import at line 14-18 area; call sites at lines 59-62, 183, 224)

**Interfaces:**
- Consumes: `applyEmphasisAndSpelling` from `../services/emphasisAndSpelling.js` (Task 2).
- Produces: every synthesis path (`/inference`, `/inference/generate`, `/inference/tts`, live `handleLiveTtsRequest`) now applies emphasis/spell-out on the full text after the runtime dictionary and before chunking/normalization.

- [ ] **Step 1: Add the import**

In `gpu-inference-worker/src/routes/inference.js`, add after the existing `prepareTextForSynthesis` import (line 14):

```js
import { applyEmphasisAndSpelling } from '../services/emphasisAndSpelling.js';
```

- [ ] **Step 2: Wire the live path**

Replace the body of `handleLiveTtsRequest` (lines 58-65) so the new step runs between the dictionary and normalization:

```js
  const resolvedParams = await resolveParams(body);
  const dictionaryText = await prepareTextWithRuntimeDictionary(resolvedParams.text);
  const emphasizedText = applyEmphasisAndSpelling(dictionaryText);
  const normalizedParams = {
    ...resolvedParams,
    text: prepareTextForSynthesis(emphasizedText),
  };
  const audioBuffer = await synthesize(normalizedParams);
  return { audioBuffer, resolvedParams: normalizedParams };
```

- [ ] **Step 3: Wire the long-text and streaming paths**

In the `/inference` handler, change line 183 from:

```js
    resolvedParams.text = await prepareTextWithRuntimeDictionary(resolvedParams.text);
```

to:

```js
    resolvedParams.text = applyEmphasisAndSpelling(await prepareTextWithRuntimeDictionary(resolvedParams.text));
```

In the `/inference/generate` handler, change line 224 identically:

```js
    resolvedParams.text = applyEmphasisAndSpelling(await prepareTextWithRuntimeDictionary(resolvedParams.text));
```

(`prepareTextForSynthesis` is applied per chunk inside `longTextInference.js`, so the new step correctly runs on the whole text before chunking.)

- [ ] **Step 4: Verify the whole worker test suite still passes**

Run: `cd gpu-inference-worker && node --test`
Expected: PASS — all `*.test.js` in the worker pass, including the new `cmuDictionary`, `emphasisAndSpelling`, and updated `textPronunciation` suites. No syntax/import errors from `inference.js`.

- [ ] **Step 5: Commit**

```bash
git add gpu-inference-worker/src/routes/inference.js
git commit -m "feat(inference): apply caps-emphasis and acronym spell-out on all TTS paths"
```

---

## Self-Review

**Spec coverage:**
- Authoring rules table → Task 2 tests cover dotted, spaced, override, auto-spell, emphasis, lowercase. ✓
- Decision logic (periods → list → real-word → emphasis) → `classifyWord` + steps 1-3 of `applyEmphasisAndSpelling`. ✓
- CMU real-word oracle with graceful fallback → Task 1. ✓
- Acronym override list for real-word∩acronym collisions → `acronymOverrides.js` in Task 2. ✓
- Quality-safe prosodic emphasis (no audio edits) → `renderEmphasis` (comma bracketing only). ✓
- Remove blanket caps auto-split → Task 3. ✓
- Wire into all four synthesis paths after dictionary, before normalization/chunking → Task 4. ✓
- No model / API-contract / frontend changes → none in any task. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code and test step is complete. ✓

**Type consistency:** `applyEmphasisAndSpelling`, `classifyWord`, `renderSpellout`, `renderEmphasis`, `loadCmuWordSet`, `isRealWord`, `ACRONYM_OVERRIDES` are named identically across the tasks that define and consume them. The `opts` shape `{ acronyms, isRealWord }` matches between `classifyWord` and its tests. ✓

**Deviation from spec (intentional):** Spec examples show `W. H. O.` (periods); the plan renders `W H O` (spaces) to preserve the exact pronunciation GPT-SoVITS already produces in production. Behavior is equivalent and isolated behind `renderSpellout` for easy tuning.
