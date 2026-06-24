# TTS Emphasis & Acronym Spell-out — Design

**Date:** 2026-06-24
**Status:** Approved (brainstorming)
**Component:** `gpu-inference-worker` (text preprocessing)

## Problem

Two requested authoring features for the TTS text box, both ElevenLabs-inspired:

1. **Emphasis via capitals.** Writing a word in ALL-CAPS (`this is REALLY important`) should make
   the cloned voice lean into that word.
2. **Acronym disambiguation.** The same letters must sometimes be spelled out and sometimes read as
   a word — the headline case being `WHO` → "W. H. O." (World Health Organization) vs. `who` → the
   ordinary word. This matters for medical/clinical scripts, which are dense with acronyms
   (`ECG`, `MRI`, `COPD`, `ICU`).

These two ideas **collide on capitalization**, and they collide with existing behavior: today
`textPronunciation.js:221` already spells out *any* bare ALL-CAPS token of 2–5 letters
(`/\b([A-Z]{2,5})\b/`) unless it is in a tiny skip-list. So `WHO` currently *always* becomes
"W H O", and there is no way to emphasize a word with caps. We need a single, predictable scheme
that separates the three intents (emphasis / spell-out / plain word).

## Constraints & context

- **GPT-SoVITS has no emphasis/SSML control.** It synthesizes from phonemes + the reference voice;
  there is no "make this word louder" parameter. Any emphasis must be manufactured from the text we
  send or from post-processing the audio.
- **Voice quality is the top priority** (explicit user requirement). The chosen emphasis mechanism
  must not degrade or alter the cloned voice.
- The stress-override file `engdict-hot.rep` is **global per word**, so it cannot add stress to a
  single occurrence of a word without affecting every occurrence. It is therefore unusable for
  per-occurrence emphasis.
- All text already passes through a preprocessing chain in `gpu-inference-worker/src/routes/inference.js`:
  `prepareTextWithRuntimeDictionary` (admin "readable" overrides) → `prepareTextForSynthesis`
  (normalization) → engine. This is the natural insertion point.
- No authentication, single inference job at a time. No DB. ES modules throughout. Tests use Node's
  built-in runner (colocated `*.test.js`).

## Authoring rules (user-facing)

| You type | Engine receives | Reason |
|---|---|---|
| `this is REALLY important` | emphasized "really" | bare ALL-CAPS = emphasis |
| `the W.H.O. guidelines` | "W. H. O." | periods (or internal spaces) = explicit spell-out |
| `order an ECG now` | "E. C. G." | not a real English word → auto spell-out |
| `the WHO recommends` | "W. H. O." | listed in the acronym override list |
| `who is the patient` | "who" | lowercase = the plain word |

## Decision logic (per whitespace-separated token)

Applied to each token, stripped of surrounding punctuation but remembering it:

1. **Dotted / internally-spaced caps** (`W.H.O.`, `E.C.G.`, `E C G`) → **spell out**. Explicit;
   always wins.
2. **Bare ALL-CAPS token** (letters only, length ≥ 2, no lowercase):
   1. in the **acronym override list** → **spell out**;
   2. else **not a real English word** (looked up in the CMU dictionary the engine itself uses) →
      **spell out** (covers `ECG`, `MRI`, `COPD`, `ICU` with zero list maintenance);
   3. else (it *is* a real English word, e.g. `REALLY`, `STOP`, `NOW`) → **emphasis**.
3. **Single capital letter** `A`, `I` → leave as-is (handled by existing `ACRONYM_SKIP` semantics;
   never spelled out, never emphasized).
4. **Anything else** (lowercase, mixed case, numbers) → unchanged.

The override list only needs words that are **both** a real English word **and** an acronym
(`WHO`, `AIDS`, `MASH`, `CARE`). Pure-acronym tokens fall through rule 2.2 automatically.

### Trade-off accepted
A word that is in the acronym override list can no longer be emphasized via caps (e.g. you cannot
emphasize the word "who" with `WHO`). This is a rare edge case; rephrasing or lowercase handles it.

## Emphasis rendering (quality-safe)

Emphasis is **prosodic only**: the emphasized word is bracketed with brief pause punctuation so the
model sets it apart, while the word itself is synthesized normally — **same phonemes, same voice, one
continuous synthesis, no audio editing**. This guarantees zero voice-quality impact.

- Implementation: wrap the word so a short pause precedes and follows it (e.g. comma-bracketing,
  tuned during implementation to avoid a "list intonation" artifact). The exact punctuation is an
  internal detail behind a single `renderEmphasis(word)` function so it can be tuned in one place.
- **Honest expectation:** the effect reads as "given a beat of space / leaned into," not
  ElevenLabs-loud. This is the cost of not touching the audio.
- **Future, out of scope for v1:** a stronger opt-in *audio-gain* mode (synthesize the word as its
  own chunk and apply gain) can be layered on later. The parser emits a neutral, tagged
  representation (see below) so a second renderer can consume the same parse without rework.

## Architecture

```
routes/inference.js preprocessing chain (all four synthesis paths):
  text
   → prepareTextWithRuntimeDictionary   (existing: admin readable overrides)
   → applyEmphasisAndSpelling           (NEW)
   → prepareTextForSynthesis            (existing: normalization, minus the old caps auto-split)
   → engine
```

### New module: `src/services/emphasisAndSpelling.js`
Single public function, pure and synchronous over a string:

```js
export function applyEmphasisAndSpelling(text, { acronyms, isRealWord } = {}) → string
```

Internally:
- **tokenize** into words + interleaved punctuation/whitespace (preserve everything non-word);
- **classify** each word token via the decision logic above into `plain | spellout | emphasis`;
- **render**: `spellout` → `renderSpellout(token)` (letters joined, e.g. "W. H. O."); `emphasis` →
  `renderEmphasis(token)` (pause-bracketed); `plain` → unchanged;
- reassemble and return the string.

Classification is separated from rendering (`classifyToken` returns a tagged token) so a future
audio-gain renderer can reuse the classifier.

### Acronym override list: `src/services/acronymOverrides.js` (or `.json`)
A small, version-controlled list of words that are both real words and acronyms (`WHO`, `AIDS`, …).
Exported as an uppercase `Set`. Documented inline so the team knows it is only for the
real-word∩acronym collision case.

### Real-word oracle: CMU dictionary loader
`isRealWord(token)` consults the same CMU dictionary GPT-SoVITS uses, so "real word" matches what the
engine would actually pronounce naturally.
- Discover the dict under `GPT_SOVITS_ROOT/GPT_SoVITS/text/` (`cmudict.rep`, falling back to
  `cmudict-fast.rep`); parse the leading word of each line into an uppercase `Set`; cache in-module.
- **Graceful degradation:** if the dict cannot be read (path missing, e.g. some local setups),
  `isRealWord` returns `false`, so bare caps not in the override list spell out. This is the safe
  default for medical scripts (acronym-heavy) and never throws.

### Modified: `src/services/textPronunciation.js`
Remove the blanket `/\b([A-Z]{2,5})\b/` acronym auto-split (rule moved to the new module). Keep all
other normalization (symbols, abbreviations, compound splits, Unicode cleanup). `ACRONYM_SKIP` logic
for single letters / common words is preserved where still relevant.

### Modified: `src/routes/inference.js`
Insert `applyEmphasisAndSpelling` between the runtime-dictionary step and `prepareTextForSynthesis`
in every path that synthesizes: `/inference`, `/inference/generate`, `/inference/tts`, and
`handleLiveTtsRequest` (live). Wire the acronym set and `isRealWord` in.

## Data flow / ordering rationale

- Runs **after** admin readable-overrides (those may rewrite specific words first) and **before**
  normalization (which strips/!rewrites punctuation and previously did the caps split). This ordering
  lets the new module see original casing and dots before normalization touches them.
- Spell-out must run before `prepareTextForSynthesis` so the emitted "W. H. O." flows through normal
  punctuation handling.

## Error handling

- Pure string transforms; never throw on malformed input — unknown tokens pass through unchanged.
- CMU dict load failure is caught and degrades to `isRealWord → false` (see above).
- No new failure modes on the synthesis paths; if the module returned the input unchanged the system
  would still work (feature-degraded, not broken).

## Testing

Colocated Node test files mirroring existing `*.test.js` style:

- `emphasisAndSpelling.test.js`:
  - dotted/spaced → spell out (`W.H.O.`, `E C G`);
  - bare caps in override list → spell out (`WHO`, `AIDS`);
  - bare caps not a real word → spell out (`ECG`, `MRI`, `COPD`);
  - bare caps that IS a real word → emphasis (`REALLY`, `STOP`);
  - lowercase / mixed case / single `A`,`I` → unchanged;
  - punctuation and spacing preserved around transformed tokens;
  - sentence with a mix of all cases;
  - `isRealWord` injected as a stub so tests don't depend on a CMU file.
- Update `textPronunciation.test.js` for the removed auto-split (bare caps no longer split there).
- A small test for the CMU loader's graceful fallback (missing file → `isRealWord` returns false).

## Out of scope (YAGNI)

- Audio-gain emphasis mode (designed-for, not built).
- Per-occurrence stress-digit injection (impossible with the global hot dict).
- Frontend/UI changes — authors type the conventions in the existing text box. (A short help tooltip
  documenting the rules is a possible nice-to-have, not required.)
- Any model, API-contract, or schema change.

## Files

- **New:** `gpu-inference-worker/src/services/emphasisAndSpelling.js` (+ `.test.js`),
  `gpu-inference-worker/src/services/acronymOverrides.js`, CMU loader (new file or folded into the
  module), CMU loader test.
- **Modified:** `gpu-inference-worker/src/services/textPronunciation.js` (+ test),
  `gpu-inference-worker/src/routes/inference.js`.
