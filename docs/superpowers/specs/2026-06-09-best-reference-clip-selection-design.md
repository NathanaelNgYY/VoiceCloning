# Best-5 Reference-Clip Selection by Audio Quality — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorming complete)

## Problem

In the Live Gateway, reference-clip selection (the "Use best" button and the
default selection shown on model load) ends up picking the **first 5 clips
chronologically** instead of the best ones.

Root cause: selection runs through `chooseBestReferenceSet()`, which exists in
two near-duplicate copies:

- `client/src/lib/referenceSelection.js` — powers the "Use best" button.
- `lambda/shared/modelSelection.js` — picks the default selection surfaced on
  model load via `warmedReferences`.

Both score clips only from **filename, transcript length, language, and
(client only) duration-derived-from-filename**. They never analyze the actual
audio. When a voice's clips are uniform-length slices of one recording (the
common case), every clip scores identically, so the tie-breaker
`filename.localeCompare` decides — which is alphabetical = chronological = the
first 5.

A real audio-quality scorer already exists at `gpu-worker/scripts/score_clips.py`
(SNR, clipping, spectral flatness, speech ratio, duration → 0–100 score) but it
is a standalone CLI wired into nothing.

## Goal

Make best-clip selection rank by **actual audio quality**, using the
`score_clips.py` metrics, in both selection paths — while leaving behavior
unchanged for voices that have no scores yet.

## Decisions (settled during brainstorming)

1. **When scoring runs:** precompute once at training time and cache to S3
   (not on-demand at load). Selection just reads the cache — no audio analysis
   at load time.
2. **Existing/older voices:** ship a backfill script to generate scores for
   already-trained voices now, AND fall back gracefully to today's filename
   heuristics whenever a cache is absent.
3. **Signal blend:** audio quality is the dominant signal; a smaller
   transcript-adequacy/language adjustment is folded in so the PRIMARY clip
   (whose transcript becomes `prompt_text`) is not a pristine-audio clip with an
   empty/garbage transcript.

## Architecture

### 1. The cache artifact: `clip-scores.json`

One file per voice, written next to the dataset:

- **S3:** `training/datasets/<exp>/clip-scores.json`
- **Local (gpu-worker):** `<dataDir>/clip-scores.json` (sibling of `denoised/`
  and `asr/`)

Shape — exactly what `score_clips.py --json` already emits, keyed by filename:

```json
{
  "<file>.wav": {
    "score": 78.4, "snr_db": 31.2, "clip_pct": 0.0,
    "flatness": 0.21, "speech_ratio": 0.71, "duration_s": 6.9
  }
}
```

Only `score` (0–100) is consumed by selection. The remaining metrics are kept
for debugging/inspection.

### 2. Producing it — new pipeline step (gpu-worker)

In `gpu-worker/src/services/pipeline.js`, after the pipeline loop completes
(clips exist in `denoisedDir`):

- Run `score_clips.py` against `denoisedDir`, writing `clip-scores.json` to the
  dataset root (`<dataDir>/clip-scores.json`).
- Upload it to `training/datasets/<exp>/clip-scores.json`, alongside the
  existing `uploadDirectory(denoisedDir, …)` / `uploadDirectory(asrDir, …)`
  calls, using the existing single-object upload helper.

Properties:

- **Non-fatal**, wrapped in try/catch like the email-notification step. If
  scoring fails (e.g. librosa import error), log a warning and let training
  succeed; selection then falls back to heuristics.
- Runs once per training on the box that already has Python + librosa + the
  audio. Scoring a few hundred clips takes seconds.
- Works in skip-denoise mode too, because `denoised/` is still populated (with
  the sliced copies) in that mode.

### 3. Surfacing scores — attach `qualityScore` to file objects

The three places that build the training-audio file list each read the cache
and add a `qualityScore` field (the `score` value) to every file object:

| Lister | Reads cache from | Feeds |
|---|---|---|
| `gpu-worker/src/routes/artifacts.js` `listTrainingAudio` | local `clip-scores.json` | gpu-worker artifacts mode |
| `lambda/training-audio/index.js` (S3 branch) | S3 `clip-scores.json` | client `trainingAudioFiles` → "Use best" |
| `lambda/shared/modelSelection.js` `loadTrainingAudioFilesForExp` (S3 branch) | S3 `clip-scores.json` | server default (`warmedReferences`) |

The two S3 readers share a small new helper `lambda/shared/clipScores.js`
exposing `loadClipScores(expName)` → `Map<filename, number>`. A missing or
corrupt cache yields an empty Map (which drives the fallback path).

When lambda proxies to the gpu-worker (`useGpuWorkerArtifacts()` true), the
gpu-worker has already attached `qualityScore` to the proxied response, so the
lambda side does not re-read in that branch.

This keeps `qualityScore` flowing through the **existing** file objects; the
scorers need no new plumbing, only a new branch.

### 4. Ranking — one new branch in each scorer

Both `chooseBestReferenceSet` scorers
(`client/src/lib/referenceSelection.js` and `lambda/shared/modelSelection.js`)
get the same change inside `scoreReferenceClip`:

```js
const audio = Number(file?.qualityScore);
if (Number.isFinite(audio)) {
  // Audio quality dominates; transcript + language act as a guard so the
  // PRIMARY (whose transcript becomes prompt_text) isn't a clean clip with
  // empty/garbage text.
  return audio + 0.3 * (transcriptScore(file.transcript) + langScore(file.lang));
}
// No cache → existing filename/transcript/duration heuristic (unchanged).
```

- `langScore(lang)` factors the existing `lang === 'en' ? 14 …` lines into a
  helper, reused by both branches.
- Duration is **not** re-added in the audio branch because the audio score
  already folds it in (`dur_s` term in `score_clips.py`).
- Ranking order, tie-breaking, and the primary/aux split are otherwise
  unchanged. Therefore, when no cache exists, output is byte-for-byte today's.

Net effect once a voice is scored/backfilled: uniform slices no longer tie; they
order by actual SNR/clarity, yielding a genuinely best-5 selection (primary +
up to 5 auxiliary).

### 5. Backfill for existing voices

A standalone operational script `gpu-worker/scripts/backfill-clip-scores.mjs`,
run on the gpu-worker / EC2 box (which has Python + librosa + S3 credentials):

```
node scripts/backfill-clip-scores.mjs <exp>     # one voice
node scripts/backfill-clip-scores.mjs --all     # every dataset missing a cache
```

For each target:

1. Download `training/datasets/<exp>/denoised/*.wav` to a temp dir.
2. Run `score_clips.py --json` over the temp dir.
3. Upload the resulting `clip-scores.json` to
   `training/datasets/<exp>/clip-scores.json`.

`--all` enumerates datasets under `training/datasets/` and skips any that
already have a `clip-scores.json`. The temp dir is cleaned up after each voice.
This lets already-trained voices (including the current test voice) benefit
immediately, with no re-training.

## Testing

- Extend `client/src/lib/referenceSelection.test.js` and
  `lambda/shared/modelSelection.test.js`:
  - With `qualityScore` present: ranking follows audio-primary +
    transcript-guard, and a high-SNR clip wins over the chronological-first
    clip.
  - Regression: with no `qualityScore`, selection output is identical to
    today's.
- New `lambda/shared/clipScores.test.js` (or co-located): `loadClipScores`
  parses a cache into a Map; a missing/corrupt file yields an empty Map.
- `score_clips.py` is unchanged, so no new Python test harness is introduced.

## Scope / footprint

- 1 new pipeline step (gpu-worker `pipeline.js`).
- 1 new shared helper (`lambda/shared/clipScores.js`).
- 1 new ranking branch in each of the 2 JS scorers (+ a shared `langScore`
  helper).
- `qualityScore` attached in 3 file listers.
- 1 new backfill script (`gpu-worker/scripts/backfill-clip-scores.mjs`).
- Tests as above.

## Non-goals

- No on-demand scoring at model-load time.
- No changes to `score_clips.py` scoring metrics or weights.
- No changes to the Live Gateway UI (the "Use best" button, primary/aux
  controls, and the 5-aux cap all stay as-is).
- No local-mode (`server/src`) auto-selection changes; local mode relies on the
  client scorer, which is covered.
