# One-click ARPAbet Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Generate** button to the Pronunciation dictionary panel so a user can type only a word, click it, and have the ARPAbet and Readable fields auto-filled from Datamuse — then Save and Load as today.

**Architecture:** A new pure-JS client lib (`client/src/lib/arpabet.js`) does the Datamuse lookup (browser → public CORS API) and converts the returned phones into an approximate readable respelling. `LivePage.jsx` gains one button, one state flag, and one handler that calls the lib and populates the existing form fields. No backend, Lambda, or worker changes.

**Tech Stack:** React 18 (existing `LivePage.jsx`), plain ESM JS lib, Node's built-in test runner (`node:test` + `node:assert/strict`, matching the sibling `pronunciationCsv.test.js`), `fetch` (global in Node 18+ and the browser), Datamuse API (`api.datamuse.com`).

## Global Constraints

- All packages use ES modules (`import`/`export`, not `require`).
- Client path alias `@/` maps to `client/src/`.
- Client `lib/` tests use Node's built-in runner — run with `node --test <file>`. Do NOT add Vitest.
- ARPAbet normalization must match `gpu-inference-worker/scripts/sync_datamuse_pronunciations.js`: strip a leading `pron:` prefix, trim, uppercase, collapse internal whitespace to single spaces.
- Generate never auto-saves; it only populates form fields. The user always clicks Save entry.

---

### Task 1: ARPAbet lib (Datamuse lookup + readable conversion)

**Files:**
- Create: `client/src/lib/arpabet.js`
- Test: `client/src/lib/arpabet.test.js`

**Interfaces:**
- Consumes: nothing (leaf module). Uses global `fetch`.
- Produces:
  - `fetchDatamuseArpabet(word: string): Promise<{ arpabet: string } | null>` — resolves `null` when the word is empty, has no results, or has no `pron:` tag; **throws** on a non-OK HTTP response or network failure.
  - `arpabetToReadable(arpabet: string): string` — returns a hyphenated syllabic respelling with the primary-stress syllable uppercased; returns `''` for empty input.

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/arpabet.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { arpabetToReadable, fetchDatamuseArpabet } from './arpabet.js';

test('arpabetToReadable renders chromosome with the stressed syllable uppercased', () => {
  assert.equal(arpabetToReadable('K R OW1 M AH0 S OW0 M'), 'KROH-muh-sohm');
});

test('arpabetToReadable renders enzyme', () => {
  assert.equal(arpabetToReadable('EH1 N Z AY0 M'), 'EH-nzym');
});

test('arpabetToReadable handles a single-syllable word', () => {
  assert.equal(arpabetToReadable('CH IY1 Z'), 'CHEEZ');
});

test('arpabetToReadable returns an empty string for empty input', () => {
  assert.equal(arpabetToReadable(''), '');
});

test('fetchDatamuseArpabet returns normalized arpabet on a hit', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => [{ word: 'chromosome', tags: ['pron:K R OW1 M AH0 S OW0 M'] }],
  });
  try {
    assert.deepEqual(await fetchDatamuseArpabet('chromosome'), { arpabet: 'K R OW1 M AH0 S OW0 M' });
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchDatamuseArpabet returns null when there are no results', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  try {
    assert.equal(await fetchDatamuseArpabet('zzzznotaword'), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchDatamuseArpabet returns null when the result lacks a pron tag', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [{ word: 'x', tags: ['n'] }] });
  try {
    assert.equal(await fetchDatamuseArpabet('x'), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchDatamuseArpabet throws on a non-OK response', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => [] });
  try {
    await assert.rejects(() => fetchDatamuseArpabet('chromosome'), /503/u);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchDatamuseArpabet returns null for an empty word without calling fetch', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => [] }; };
  try {
    assert.equal(await fetchDatamuseArpabet('   '), null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && node --test src/lib/arpabet.test.js`
Expected: FAIL — cannot resolve `./arpabet.js` (module not found).

- [ ] **Step 3: Write the minimal implementation**

Create `client/src/lib/arpabet.js`:

```js
const PHONEME_GRAPHEMES = {
  AA: 'ah', AE: 'a', AH: 'uh', AO: 'aw', AW: 'ow', AY: 'y', EH: 'eh', ER: 'ur',
  EY: 'ay', IH: 'ih', IY: 'ee', OW: 'oh', OY: 'oy', UH: 'uu', UW: 'oo',
  B: 'b', CH: 'ch', D: 'd', DH: 'th', F: 'f', G: 'g', HH: 'h', JH: 'j', K: 'k',
  L: 'l', M: 'm', N: 'n', NG: 'ng', P: 'p', R: 'r', S: 's', SH: 'sh', T: 't',
  TH: 'th', V: 'v', W: 'w', Y: 'y', Z: 'z', ZH: 'zh',
};

const VOWELS = new Set([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER',
  'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW',
]);

function normalizeArpabet(value) {
  return String(value || '')
    .replace(/^pron:/u, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/gu, ' ');
}

export function arpabetToReadable(arpabet) {
  const tokens = normalizeArpabet(arpabet).split(' ').filter(Boolean);
  if (tokens.length === 0) return '';

  const syllables = [];
  let onset = '';
  for (const token of tokens) {
    const phoneme = token.replace(/\d/gu, '');
    const stressed = /1/u.test(token);
    const grapheme = PHONEME_GRAPHEMES[phoneme] ?? phoneme.toLowerCase();
    if (VOWELS.has(phoneme)) {
      syllables.push({ text: onset + grapheme, stressed });
      onset = '';
    } else {
      onset += grapheme;
    }
  }
  if (onset) {
    if (syllables.length === 0) return onset; // consonants only, no vowel
    syllables[syllables.length - 1].text += onset; // trailing coda
  }

  return syllables
    .map((syllable) => (syllable.stressed ? syllable.text.toUpperCase() : syllable.text))
    .join('-');
}

export async function fetchDatamuseArpabet(word) {
  const term = String(word || '').trim();
  if (!term) return null;

  const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(term)}&md=r&max=1`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Datamuse returned ${response.status}`);

  const results = await response.json();
  if (!Array.isArray(results) || results.length === 0) return null;

  const match =
    results.find((item) => String(item.word || '').toLowerCase() === term.toLowerCase()) || results[0];
  const pron = match?.tags?.find((tag) => String(tag).startsWith('pron:'));
  const arpabet = normalizeArpabet(pron);
  return arpabet ? { arpabet } : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && node --test src/lib/arpabet.test.js`
Expected: PASS — all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/arpabet.js client/src/lib/arpabet.test.js
git commit -m "Add Datamuse ARPAbet lookup + readable respelling lib"
```

---

### Task 2: Wire the Generate button into the Pronunciation dictionary panel

**Files:**
- Modify: `client/src/pages/LivePage.jsx` (imports near line 1–80; pronunciation state near line 369–376; add handler near the `savePronunciation` function ~line 1927; add button in the action row ~line 3204–3208)

**Interfaces:**
- Consumes from Task 1: `fetchDatamuseArpabet`, `arpabetToReadable` from `@/lib/arpabet`.
- Produces: no exports — UI wiring only. Verified manually.

- [ ] **Step 1: Import the lib functions**

Add an import alongside the other `@/lib` imports near the top of `client/src/pages/LivePage.jsx` (the file already imports `generateLiveFastQueuedTts` from `@/lib/liveFastQueuedTts` around line 76 — put this near it):

```jsx
import { fetchDatamuseArpabet, arpabetToReadable } from '@/lib/arpabet';
```

- [ ] **Step 2: Add the generating state flag**

Immediately after the `pronunciationBusy` state declaration (currently around line 376):

```jsx
  const [pronunciationGenerating, setPronunciationGenerating] = useState(false);
```

- [ ] **Step 3: Add the `generatePronunciation` handler**

Insert this function directly above the existing `async function savePronunciation()` (currently around line 1927):

```jsx
  async function generatePronunciation() {
    const word = pronunciationWord.trim();
    if (!word) {
      setPronunciationMessage('Enter a word first.');
      return;
    }
    setPronunciationGenerating(true);
    setPronunciationMessage('');
    try {
      const result = await fetchDatamuseArpabet(word);
      if (!result) {
        setPronunciationMessage(`No pronunciation found for "${word}" — enter it manually.`);
        return;
      }
      setPronunciationArpabet(result.arpabet);
      setPronunciationReadable(arpabetToReadable(result.arpabet));
      setPronunciationMessage('Generated — review and Save entry.');
    } catch {
      setPronunciationMessage('Could not reach Datamuse — check your connection or enter manually.');
    } finally {
      setPronunciationGenerating(false);
    }
  }
```

- [ ] **Step 4: Add the Generate button to the action row**

In the action-row `<div className="mt-3 flex flex-wrap gap-2">` (currently ~line 3204), insert the Generate button as the FIRST button, immediately before the existing Save-entry `<Button>` (the one wrapping `{editingPronunciationWord ? 'Update entry' : 'Save entry'}`):

```jsx
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={generatePronunciation}
                  disabled={pronunciationBusy || pronunciationGenerating || !pronunciationWord.trim()}
                  className="h-8 rounded-lg border-slate-200 bg-white"
                >
                  {pronunciationGenerating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  Generate
                </Button>
```

- [ ] **Step 5: Ensure the `Sparkles` icon is imported**

Check the `lucide-react` import block at the top of `LivePage.jsx`. If `Sparkles` is not already in the named imports, add it (the file already imports icons like `Check`, `PlayCircle`, `Loader2`, `RefreshCw`). If `Sparkles` is not desired or unavailable, reuse the already-imported `RefreshCw` icon instead and skip this step.

Verify the icon import resolves:

Run: `cd client && node -e "import('lucide-react').then((m) => console.log('Sparkles' in m ? 'ok' : 'missing'))"`
Expected: `ok`

- [ ] **Step 6: Verify the production build compiles**

Run: `cd client && npm run build`
Expected: build completes with no errors and writes to `client/dist`.

- [ ] **Step 7: Manual verification**

Run: `cd client && npm run dev`, open the Live page, scroll to the **Pronunciation dictionary** panel, and confirm:
1. Type `Chromosome` in Word, click **Generate** → ARPAbet fills with `K R OW1 M AH0 S OW0 M` and Readable fills with `KROH-muh-sohm`; message reads "Generated — review and Save entry."
2. Type a nonsense word (e.g. `zzzznotaword`), click **Generate** → message reads `No pronunciation found for "zzzznotaword" — enter it manually.` and the fields are unchanged.
3. Clear the Word field → the **Generate** button is disabled.
4. After a successful Generate, **Save entry** then **Load changes** still work exactly as before.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/LivePage.jsx
git commit -m "Add Generate button to auto-fill pronunciation from a word"
```

---

## Self-Review

**Spec coverage:**
- Datamuse-only lookup, browser-direct → Task 1 `fetchDatamuseArpabet`. ✓
- Fills ARPAbet + readable respelling → Task 1 `arpabetToReadable`, Task 2 handler sets both fields. ✓
- Generate button + handler + state + messages (empty word, not-found, network error) → Task 2. ✓
- Never auto-saves → handler only sets form state; Save entry unchanged. ✓
- Normalization matches the sync script → shared `normalizeArpabet` logic in Task 1. ✓
- Tests for both functions (hit, miss, no-tag, non-OK, empty) → Task 1 Step 1. ✓
- Out-of-scope items (G2P, Save/Load/CSV/Test/backend) untouched. ✓

**Placeholder scan:** No TBD/TODO; all steps show concrete code and exact commands. ✓

**Type consistency:** `fetchDatamuseArpabet` returns `{ arpabet } | null` and Task 2 reads `result.arpabet`; `arpabetToReadable` takes/returns strings — consistent across both tasks. ✓
