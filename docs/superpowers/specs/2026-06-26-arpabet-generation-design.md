# One-click ARPAbet generation for the Pronunciation dictionary

**Date:** 2026-06-26
**Status:** Approved (design)
**Area:** Client (`LivePage.jsx`), new client lib

## Problem

The Pronunciation dictionary panel in `client/src/pages/LivePage.jsx` requires the user to
manually fill three fields for every entry: **Word**, **Readable pronunciation**, and **ARPAbet**.
Producing correct ARPAbet by hand (e.g. `EH1 N Z AY0 M` for *enzyme*) is the hard, error-prone part
and the main friction. The user wants to type only the word, click a button, and have the rest
generated — then Save and Load as they already do.

The repo already contains a Datamuse-based ARPAbet lookup (`gpu-inference-worker/scripts/sync_datamuse_pronunciations.js`),
proving the approach works; it is a Node maintenance script and is not wired to the UI.

## Goal

Add a **Generate** button to the Pronunciation dictionary panel. Given the Word, it auto-fills the
**ARPAbet** field (precise, from Datamuse/CMUdict) and the **Readable** field (an approximate
respelling derived from the phones). The existing *Save entry* → *Load changes* flow is unchanged.

## Decisions

- **Source:** Datamuse / CMUdict only, via `md=r`. No grapheme-to-phoneme fallback. Words not in
  CMUdict (many rare medical terms, novel names) return "not found" and the user enters them manually.
- **Output:** Both ARPAbet and a Readable respelling are filled. ARPAbet is authoritative; Readable
  is an approximate convenience the user can edit.
- **Location:** The browser calls `https://api.datamuse.com` directly. Datamuse is a public,
  CORS-enabled API, so no backend changes, no Lambda or worker redeploy are required.
- **Never auto-save:** Generate only populates the form fields. The user always reviews and clicks
  Save entry explicitly.

## Components

### 1. `client/src/lib/arpabet.js` (new) + `arpabet.test.js`

Pure functions, no React.

- `fetchDatamuseArpabet(word)`
  - Calls `https://api.datamuse.com/words?sp=<word>&md=r&max=1`.
  - Picks the exact case-insensitive match if present, else the first result.
  - Extracts the `pron:`-prefixed tag, normalizes: strip the `pron:` prefix, trim, uppercase,
    collapse internal whitespace to single spaces. This mirrors `normalizePronunciation` /
    `lookupWord` in `sync_datamuse_pronunciations.js` so UI and script agree.
  - Returns `{ arpabet }` on success, or `null` when there is no result or no pronunciation tag.
  - Throws on network / non-OK HTTP so the caller can show a distinct error.

- `arpabetToReadable(arpabet)`
  - Converts a normalized ARPAbet string (e.g. `K R OW1 M AH0 S OW0 M`) into a rough syllabic
    respelling (e.g. `KROH-muh-sohm`).
  - Algorithm: map each phoneme (stress digits stripped) to a readable grapheme via a fixed table;
    group phonemes into syllables anchored one-per-vowel (consonants form the onset of the syllable
    whose vowel follows; trailing consonants attach to the final syllable's coda); join syllables
    with `-`; render the primary-stress (`1`) syllable in UPPERCASE and others in lowercase. If no
    stress marker exists, leave all lowercase.
  - Explicitly approximate. Returns `''` for empty input.

A representative phoneme→grapheme table (vowels then consonants):
`AA→ah, AE→a, AH→uh, AO→aw, AW→ow, AY→y, EH→eh, ER→ur, EY→ay, IH→ih, IY→ee, OW→oh,`
`OY→oy, UH→uu, UW→oo; B→b, CH→ch, D→d, DH→th, F→f, G→g, HH→h, JH→j, K→k, L→l, M→m,`
`N→n, NG→ng, P→p, R→r, S→s, SH→sh, T→t, TH→th, V→v, W→w, Y→y, Z→z, ZH→zh`.
(Exact entries are an implementation detail; the plan may tune them against the test cases.)

### 2. `client/src/pages/LivePage.jsx`

- New state: `pronunciationGenerating` (boolean).
- New handler `generatePronunciation()`:
  1. Trim the word; if empty, set message "Enter a word first." and return.
  2. Set `pronunciationGenerating` true, clear message.
  3. `await fetchDatamuseArpabet(word)`:
     - On `null`: message `No pronunciation found for "<word>" — enter it manually.`
     - On hit: `setPronunciationArpabet(arpabet)`, `setPronunciationReadable(arpabetToReadable(arpabet))`,
       message "Generated — review and Save entry."
  4. `catch`: message "Could not reach Datamuse — check your connection or enter manually."
  5. `finally`: clear `pronunciationGenerating`.
- New **Generate** button in the panel's action row (alongside Save entry / Test), disabled while
  `pronunciationGenerating` or `pronunciationBusy`, showing a spinner while generating.

## Data flow

```
Word input
  → [Generate] → fetchDatamuseArpabet(word)
      → normalize ARPAbet  → setPronunciationArpabet
      → arpabetToReadable  → setPronunciationReadable
  → user reviews / edits fields
  → [Save entry]   (existing savePronunciation)
  → [Load changes] (existing loadPendingPronunciationChanges)
```

## Error handling

All surfaced through the existing `pronunciationMessage` line, with distinct text for: empty word,
word-not-found, and network/Datamuse failure. Generate never mutates the saved dictionary.

## Testing

Vitest, co-located:
- `arpabetToReadable`: chromosome (`K R OW1 M AH0 S OW0 M`), enzyme (`EH1 N Z AY0 M`), a
  single-syllable word, and empty input.
- `fetchDatamuseArpabet`: mocked `fetch` for a hit (asserts normalized ARPAbet), a miss (empty
  results → `null`), a result with no `pron:` tag → `null`, and a non-OK response → throws.

## Out of scope

- Grapheme-to-phoneme generation for words absent from CMUdict.
- Any change to Save entry, Load changes, CSV import/export, Test, or the Lambda/worker dictionary
  storage and hot-dict sync.
