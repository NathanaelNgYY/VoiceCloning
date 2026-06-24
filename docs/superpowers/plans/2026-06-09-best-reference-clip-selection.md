# Best-5 Reference-Clip Selection by Audio Quality — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank reference-clip selection by real audio quality (SNR/clipping/flatness, computed once at training time and cached to S3) in both the "Use best" button and the server default, falling back to today's heuristics when no cache exists.

**Architecture:** A new gpu-worker pipeline step runs the existing `score_clips.py` over the denoised clips and uploads `clip-scores.json` next to the dataset. The three training-audio listers attach each clip's `qualityScore` to the file objects they already return. Both `chooseBestReferenceSet` scorers gain one early branch: when `qualityScore` is present, rank by it plus a small transcript/language guard; otherwise behave exactly as today. A standalone backfill script scores already-trained voices.

**Tech Stack:** Node.js (ESM), `node:test` + `node:assert/strict`, AWS SDK v3 (`@aws-sdk/client-s3`), Python (`score_clips.py`, numpy + librosa from the GPT-SoVITS runtime).

**Spec:** `docs/superpowers/specs/2026-06-09-best-reference-clip-selection-design.md`

---

## File Structure

**New files:**
- `lambda/shared/clipScores.js` — `loadClipScores(expName)` → `Map<filename, score>` from S3.
- `lambda/shared/clipScores.test.js` — tests for the helper.
- `gpu-worker/scripts/backfill-clip-scores.mjs` — one-off scorer for existing voices.

**Modified files:**
- `gpu-worker/src/config.js` — add `SCRIPTS.scoreClips`.
- `gpu-worker/src/services/pipeline.js` — new scoring step + upload.
- `gpu-worker/src/routes/artifacts.js` — attach `qualityScore` (local cache).
- `gpu-worker/src/services/s3Sync.js` — add `listSubPrefixes` + `objectExists`.
- `lambda/training-audio/index.js` — attach `qualityScore` (S3 cache).
- `lambda/shared/modelSelection.js` — attach `qualityScore` + new ranking branch + `langScore` helper.
- `lambda/shared/modelSelection.test.js` — ranking test.
- `client/src/lib/referenceSelection.js` — new ranking branch + `langScore` helper + dynamic reason.
- `client/src/lib/referenceSelection.test.js` — ranking + guard tests.

**The `qualityScore` contract (used everywhere):** a finite `Number` (0–100) when a cached score exists for that clip; `undefined` otherwise. `Number.isFinite(Number(file.qualityScore))` is the single gate that switches a scorer between the audio path and the heuristic fallback.

---

## Task 1: Register `score_clips.py` in the gpu-worker SCRIPTS config

**Files:**
- Modify: `gpu-worker/src/config.js:1-9` (imports) and `gpu-worker/src/config.js:75-87` (SCRIPTS)

`score_clips.py` lives in the gpu-worker repo (`gpu-worker/scripts/`), not under `GPT_SOVITS_ROOT`, so its path is resolved relative to `config.js` via `import.meta.url`.

- [ ] **Step 1: Add the `url` import**

At the top of `gpu-worker/src/config.js`, the existing imports start with:

```js
import path from 'path';
import fs from 'fs';
```

Add a third line immediately after them:

```js
import { fileURLToPath } from 'url';
```

- [ ] **Step 2: Add `scoreClips` to the SCRIPTS map**

In the `export const SCRIPTS = { … }` object, add this entry after the `apiServer` line (before the closing `};`):

```js
  apiServer: path.join(GPT_SOVITS_ROOT, 'api_v2.py'),
  scoreClips: fileURLToPath(new URL('../scripts/score_clips.py', import.meta.url)),
};
```

- [ ] **Step 3: Verify the path resolves to the repo script**

Run (from repo root):

```bash
node --input-type=module -e "import { SCRIPTS } from './gpu-worker/src/config.js'; console.log(SCRIPTS.scoreClips)"
```

Expected: a path ending in `gpu-worker/scripts/score_clips.py` (Windows: `...\gpu-worker\scripts\score_clips.py`). If `config.js` throws because required env vars are missing, set a dummy `GPT_SOVITS_ROOT` for the check: prefix the command with `GPT_SOVITS_ROOT=/tmp ` (PowerShell: `$env:GPT_SOVITS_ROOT='C:\tmp';` then the node command).

- [ ] **Step 4: Commit**

```bash
git add gpu-worker/src/config.js
git commit -m "feat(gpu-worker): register score_clips.py in SCRIPTS config"
```

---

## Task 2: Add the clip-scoring step to the training pipeline

**Files:**
- Modify: `gpu-worker/src/services/pipeline.js` — after the steps loop (`pipeline.js:360-365`) and inside the S3 sync block (`pipeline.js:373-377`)

`score_clips.py` takes a directory positional arg and `--json <out>`. Run it via `processManager.run` (same mechanism as the denoise/ASR steps — it sets `sys.argv` and runs the script as `__main__`, with numpy/librosa available from the runtime). It must be **non-fatal**, like the email step.

- [ ] **Step 1: Compute scores after the pipeline loop**

In `runPipelineWithS3`, the loop currently looks like:

```js
    for (let i = 0; i < steps.length; i++) {
      const result = await steps[i]();
      if (result !== 'skipped') {
        completeStep(sessionId, i, 0);
      }
    }

    // ── S3 Sync Up ──
```

Insert the scoring block between the loop and the `// ── S3 Sync Up ──` comment:

```js
    for (let i = 0; i < steps.length; i++) {
      const result = await steps[i]();
      if (result !== 'skipped') {
        completeStep(sessionId, i, 0);
      }
    }

    // ── Reference-clip quality scoring (non-fatal) ──
    const clipScoresPath = path.join(dataDir, 'clip-scores.json');
    try {
      recordTrainingLog(sessionId, {
        stream: 'stdout',
        data: 'Scoring reference clips for audio quality...\n',
      });
      await processManager.run({
        scriptPath: SCRIPTS.scoreClips,
        args: [denoisedDir, '--json', clipScoresPath],
        sessionId,
      });
    } catch (scoreErr) {
      recordTrainingLog(sessionId, {
        stream: 'stderr',
        data: `Clip scoring failed (non-fatal): ${scoreErr.message || scoreErr}\n`,
      });
    }

    // ── S3 Sync Up ──
```

(`dataDir` and `denoisedDir` are already in scope — defined near `pipeline.js:136`. `path`, `SCRIPTS`, `processManager`, and `recordTrainingLog` are already imported.)

- [ ] **Step 2: Upload the cache alongside the other artifacts**

The S3 sync block currently reads:

```js
    const s3DataPrefix = `training/datasets/${expName}/`;
    await uploadDirectory(denoisedDir, `${s3DataPrefix}denoised/`);
    await uploadDirectory(asrDir, `${s3DataPrefix}asr/`);
```

Add the clip-scores upload right after the `asrDir` upload:

```js
    const s3DataPrefix = `training/datasets/${expName}/`;
    await uploadDirectory(denoisedDir, `${s3DataPrefix}denoised/`);
    await uploadDirectory(asrDir, `${s3DataPrefix}asr/`);
    if (fs.existsSync(clipScoresPath)) {
      await uploadFile(clipScoresPath, `${s3DataPrefix}clip-scores.json`);
    }
```

(`fs` is imported at the top of the file; `uploadFile` is already imported from `./s3Sync.js` at `pipeline.js:15`.)

- [ ] **Step 3: Verify the file parses (syntax check)**

Run (from repo root):

```bash
node --check gpu-worker/src/services/pipeline.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Manual verification note (no unit test)**

This step depends on Python/librosa and a live training run, so it is verified manually during a training run on the gpu-worker box: after a job completes, confirm the training log shows `Scoring reference clips for audio quality...` and that `training/datasets/<exp>/clip-scores.json` exists in S3. Record this as a manual check; do not block the plan on a unit test here.

- [ ] **Step 5: Commit**

```bash
git add gpu-worker/src/services/pipeline.js
git commit -m "feat(gpu-worker): score reference clips and cache clip-scores.json after training"
```

---

## Task 3: Attach `qualityScore` in the gpu-worker artifacts lister

**Files:**
- Modify: `gpu-worker/src/routes/artifacts.js:61-88` (`listTrainingAudio`)

The gpu-worker reads its local `clip-scores.json` (sibling of `denoised/`) and stamps `qualityScore` onto each file.

- [ ] **Step 1: Add a local cache reader**

In `gpu-worker/src/routes/artifacts.js`, add this function immediately above `function listTrainingAudio(expName) {` (around line 61):

```js
function readClipScores(dataDir) {
  const scores = new Map();
  const scoresPath = path.join(dataDir, 'clip-scores.json');
  if (!fs.existsSync(scoresPath)) return scores;
  try {
    const parsed = JSON.parse(fs.readFileSync(scoresPath, 'utf-8'));
    for (const [filename, entry] of Object.entries(parsed)) {
      const score = Number(entry?.score);
      if (Number.isFinite(score)) scores.set(filename, score);
    }
  } catch {
    // Corrupt/unreadable cache → no scores → heuristic fallback downstream.
  }
  return scores;
}
```

(`path` and `fs` are already imported at the top of `artifacts.js`.)

- [ ] **Step 2: Stamp `qualityScore` onto each file**

`listTrainingAudio` currently builds files like this inside the `for (const dataDir of expDataDirs(expName))` loop:

```js
    const transcriptMap = readTranscriptMap(path.join(dataDir, 'asr'));
    for (const filename of fs.readdirSync(denoisedDir).sort()) {
      const filePath = path.join(denoisedDir, filename);
      const ext = path.extname(filename).toLowerCase();
      if (!fs.statSync(filePath).isFile() || !AUDIO_EXTENSIONS.has(ext)) continue;
      if (files.has(filename)) continue;

      const transcript = transcriptMap.get(filename) || {};
      files.set(filename, {
        filename,
        key: filePath,
        path: filePath,
        transcript: transcript.transcript || '',
        lang: transcript.lang || '',
        source: 'gpu-worker',
      });
    }
```

Add a `readClipScores` call before the inner loop and a `qualityScore` field in the object:

```js
    const transcriptMap = readTranscriptMap(path.join(dataDir, 'asr'));
    const clipScores = readClipScores(dataDir);
    for (const filename of fs.readdirSync(denoisedDir).sort()) {
      const filePath = path.join(denoisedDir, filename);
      const ext = path.extname(filename).toLowerCase();
      if (!fs.statSync(filePath).isFile() || !AUDIO_EXTENSIONS.has(ext)) continue;
      if (files.has(filename)) continue;

      const transcript = transcriptMap.get(filename) || {};
      files.set(filename, {
        filename,
        key: filePath,
        path: filePath,
        transcript: transcript.transcript || '',
        lang: transcript.lang || '',
        qualityScore: clipScores.get(filename),
        source: 'gpu-worker',
      });
    }
```

- [ ] **Step 3: Syntax check**

Run:

```bash
node --check gpu-worker/src/routes/artifacts.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add gpu-worker/src/routes/artifacts.js
git commit -m "feat(gpu-worker): surface clip qualityScore in training-audio listing"
```

---

## Task 4: Create the shared `loadClipScores` S3 helper (TDD)

**Files:**
- Create: `lambda/shared/clipScores.js`
- Test: `lambda/shared/clipScores.test.js`

- [ ] **Step 1: Write the failing test**

Create `lambda/shared/clipScores.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadClipScores } from './clipScores.js';

function bufferJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf-8');
}

test('loadClipScores reads the dataset cache into a filename→score map', async () => {
  const readKeys = [];
  const scores = await loadClipScores('lecturer-a', {
    readObject: async (key) => {
      readKeys.push(key);
      return bufferJson({
        'a.wav': { score: 81.5, snr_db: 30 },
        'b.wav': { score: 42.0, snr_db: 12 },
      });
    },
  });

  assert.deepEqual(readKeys, ['training/datasets/lecturer-a/clip-scores.json']);
  assert.equal(scores.get('a.wav'), 81.5);
  assert.equal(scores.get('b.wav'), 42.0);
});

test('loadClipScores returns an empty map when the cache is missing or unreadable', async () => {
  const missing = await loadClipScores('lecturer-a', {
    readObject: async () => { throw new Error('NoSuchKey'); },
  });
  assert.equal(missing.size, 0);

  const garbage = await loadClipScores('lecturer-a', {
    readObject: async () => Buffer.from('not json', 'utf-8'),
  });
  assert.equal(garbage.size, 0);
});

test('loadClipScores skips entries with non-numeric scores', async () => {
  const scores = await loadClipScores('lecturer-a', {
    readObject: async () => bufferJson({
      'good.wav': { score: 70 },
      'bad.wav': { score: 'oops' },
      'none.wav': {},
    }),
  });
  assert.equal(scores.get('good.wav'), 70);
  assert.equal(scores.has('bad.wav'), false);
  assert.equal(scores.has('none.wav'), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `lambda/`):

```bash
cd lambda && node --test shared/clipScores.test.js
```

Expected: FAIL — cannot find module `./clipScores.js`.

- [ ] **Step 3: Write the implementation**

Create `lambda/shared/clipScores.js`:

```js
import { getObject } from './s3.js';

// Loads the per-voice audio-quality cache written at training time
// (training/datasets/<exp>/clip-scores.json) into a filename→score map.
// A missing or unreadable cache yields an empty map, which makes callers
// fall back to the filename/transcript heuristics.
export async function loadClipScores(expName, { readObject = getObject } = {}) {
  const scores = new Map();
  const normalizedExpName = String(expName || '').trim();
  if (!normalizedExpName) return scores;

  try {
    const raw = await readObject(`training/datasets/${normalizedExpName}/clip-scores.json`);
    if (!raw) return scores;
    const parsed = JSON.parse(raw.toString('utf-8'));
    for (const [filename, entry] of Object.entries(parsed)) {
      const score = Number(entry?.score);
      if (Number.isFinite(score)) scores.set(filename, score);
    }
  } catch {
    // No cache yet, or unreadable → empty map → heuristic fallback.
  }

  return scores;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `lambda/`):

```bash
cd lambda && node --test shared/clipScores.test.js
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lambda/shared/clipScores.js lambda/shared/clipScores.test.js
git commit -m "feat(lambda): add loadClipScores S3 cache helper"
```

---

## Task 5: Attach `qualityScore` in the lambda training-audio endpoint

**Files:**
- Modify: `lambda/training-audio/index.js:1-6` (imports) and `lambda/training-audio/index.js:61-95` (S3 branch)

The client fetches `trainingAudioFiles` from this endpoint in pure-S3 mode (the `useGpuWorkerArtifacts()` branch already proxies the gpu-worker, which now includes scores — so only the S3 branch needs changing).

- [ ] **Step 1: Import the helper**

The imports at the top of `lambda/training-audio/index.js` currently include:

```js
import { generatePresignedGetUrl, listObjects, getObject } from '../shared/s3.js';
```

Add an import below the existing shared imports:

```js
import { loadClipScores } from '../shared/clipScores.js';
```

- [ ] **Step 2: Stamp `qualityScore` onto each file**

The S3 branch currently ends with:

```js
      const files = wavFiles.map((filename) => {
        const info = transcriptMap.get(filename) || {};
        return {
          filename,
          key: `${denoisedPrefix}${filename}`,
          path: `${denoisedPrefix}${filename}`,
          transcript: info.transcript || '',
          lang: info.lang || '',
        };
      });
      return ok({ expName, files });
```

Load scores just before building `files` and add the field:

```js
      const clipScores = await loadClipScores(expName);
      const files = wavFiles.map((filename) => {
        const info = transcriptMap.get(filename) || {};
        return {
          filename,
          key: `${denoisedPrefix}${filename}`,
          path: `${denoisedPrefix}${filename}`,
          transcript: info.transcript || '',
          lang: info.lang || '',
          qualityScore: clipScores.get(filename),
        };
      });
      return ok({ expName, files });
```

- [ ] **Step 3: Syntax check**

Run:

```bash
node --check lambda/training-audio/index.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add lambda/training-audio/index.js
git commit -m "feat(lambda): include clip qualityScore in training-audio endpoint"
```

---

## Task 6: Attach `qualityScore` in modelSelection's S3 lister

**Files:**
- Modify: `lambda/shared/modelSelection.js:1-5` (imports) and `lambda/shared/modelSelection.js:99-144` (`loadTrainingAudioFilesForExp`)

This is the lister behind the **server default** selection (`warmedReferences`) — the path that produced the "first 5" in the screenshot.

- [ ] **Step 1: Import the helper**

The imports at the top of `lambda/shared/modelSelection.js` currently include:

```js
import { getObject, listObjects, uploadBuffer } from './s3.js';
```

Add below the existing imports:

```js
import { loadClipScores } from './clipScores.js';
```

- [ ] **Step 2: Stamp `qualityScore` onto each file (S3 branch only)**

The end of `loadTrainingAudioFilesForExp` currently reads:

```js
  return wavFiles.map((filename) => {
    const info = transcriptMap.get(filename) || {};
    return {
      filename,
      key: `${denoisedPrefix}${filename}`,
      path: `${denoisedPrefix}${filename}`,
      transcript: info.transcript || '',
      lang: info.lang || '',
    };
  });
}
```

Load scores and add the field (the earlier `useGpuWorkerArtifacts()` branch returns the gpu-worker response unchanged — it already carries scores):

```js
  const clipScores = await loadClipScores(normalizedExpName);
  return wavFiles.map((filename) => {
    const info = transcriptMap.get(filename) || {};
    return {
      filename,
      key: `${denoisedPrefix}${filename}`,
      path: `${denoisedPrefix}${filename}`,
      transcript: info.transcript || '',
      lang: info.lang || '',
      qualityScore: clipScores.get(filename),
    };
  });
}
```

- [ ] **Step 3: Syntax check**

Run:

```bash
node --check lambda/shared/modelSelection.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add lambda/shared/modelSelection.js
git commit -m "feat(lambda): load clip qualityScore in modelSelection training-audio lister"
```

---

## Task 7: Add the audio-quality ranking branch to modelSelection (TDD)

**Files:**
- Modify: `lambda/shared/modelSelection.js:49-68` (`scoreReferenceClip`) and the lang lines within it
- Test: `lambda/shared/modelSelection.test.js`

When a clip has a finite `qualityScore`, rank by it plus `0.3 × (transcriptScore + langScore)`; otherwise keep today's heuristic. Tested through the already-exported `resolveSavedProfileReferenceSelection`, which calls `chooseBestReferenceSet` internally.

- [ ] **Step 1: Write the failing test**

Append to `lambda/shared/modelSelection.test.js` (it already imports `node:test`/`assert`; add the new import at the top alongside the existing `import { loadModelPair } from './modelSelection.js';`):

```js
import { resolveSavedProfileReferenceSelection } from './modelSelection.js';
```

Then add these tests at the end of the file:

```js
test('resolveSavedProfileReferenceSelection ranks training audio by audio quality score', async () => {
  const selection = await resolveSavedProfileReferenceSelection(
    { sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth' },
    {
      listTrainingAudioFiles: async () => ([
        { filename: 'a.wav', path: 'training/datasets/lecturer-a/denoised/a.wav', transcript: 'Clear reference sentence one for testing.', lang: 'en', qualityScore: 40 },
        { filename: 'b.wav', path: 'training/datasets/lecturer-a/denoised/b.wav', transcript: 'Clear reference sentence two for testing.', lang: 'en', qualityScore: 90 },
        { filename: 'c.wav', path: 'training/datasets/lecturer-a/denoised/c.wav', transcript: 'Clear reference sentence three for testing.', lang: 'en', qualityScore: 65 },
      ]),
    },
  );

  assert.equal(selection.ref_audio_path, 'training/datasets/lecturer-a/denoised/b.wav');
  assert.deepEqual(selection.aux_ref_audio_paths, [
    'training/datasets/lecturer-a/denoised/c.wav',
    'training/datasets/lecturer-a/denoised/a.wav',
  ]);
});

test('resolveSavedProfileReferenceSelection transcript guard avoids an empty-transcript primary', async () => {
  const selection = await resolveSavedProfileReferenceSelection(
    { sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth' },
    {
      listTrainingAudioFiles: async () => ([
        { filename: 'pristine.wav', path: 'training/datasets/lecturer-a/denoised/pristine.wav', transcript: '', lang: 'en', qualityScore: 85 },
        { filename: 'usable.wav', path: 'training/datasets/lecturer-a/denoised/usable.wav', transcript: 'This is a perfectly usable reference sentence for cloning.', lang: 'en', qualityScore: 75 },
      ]),
    },
  );

  assert.equal(selection.ref_audio_path, 'training/datasets/lecturer-a/denoised/usable.wav');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `lambda/`):

```bash
cd lambda && node --test shared/modelSelection.test.js
```

Expected: the two new tests FAIL — without the audio branch, ranking falls back to heuristics where all four clips tie and `a.wav` (alphabetical) wins primary, so `ref_audio_path` is `…/a.wav`, not `…/b.wav`.

- [ ] **Step 3: Add the `langScore` helper**

`scoreReferenceClip` currently contains these lang lines:

```js
  if (lang === 'en' || lang === 'eng') score += 14;
  else if (lang === 'auto' || !lang) score += 3;
```

Add a `langScore` helper above `scoreReferenceClip` (just after `transcriptScore`, around `modelSelection.js:47`):

```js
function langScore(lang = '') {
  const normalized = normalizeLang(lang);
  if (normalized === 'en' || normalized === 'eng') return 14;
  if (normalized === 'auto' || !normalized) return 3;
  return 0;
}
```

- [ ] **Step 4: Add the audio branch and reuse `langScore`**

Replace the body of `scoreReferenceClip` so it short-circuits on a cached score and uses `langScore` in the fallback:

```js
function scoreReferenceClip(file) {
  const audioScore = Number(file?.qualityScore);
  if (Number.isFinite(audioScore)) {
    // Audio quality dominates; transcript + language guard so the PRIMARY
    // (whose transcript becomes prompt_text) isn't a clean clip with no text.
    return audioScore + 0.3 * (transcriptScore(file?.transcript) + langScore(file?.lang));
  }

  const filename = file?.filename || getBasename(file?.path);
  const ext = extensionOf(filename);

  let score = transcriptScore(file?.transcript);

  if (GOOD_AUDIO_EXTENSIONS.has(ext)) score += 18;
  else if (OK_AUDIO_EXTENSIONS.has(ext)) score += 6;

  score += langScore(file?.lang);

  if (GOOD_NAME_RE.test(filename)) score += 14;
  if (/(^|[_\-\s])(reference|ref)([_\-\s]|\d|$)/i.test(filename)) score += 8;
  if (/(^|[_\-\s])(aux|auxiliary)([_\-\s]|\d|$)/i.test(filename)) score -= 4;
  if (RISKY_NAME_RE.test(filename)) score -= 32;

  return score;
}
```

(The `lang` local variable and its two `score +=` lines are removed — `langScore(file?.lang)` replaces them. `normalizeLang` is still used inside `langScore`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `lambda/`):

```bash
cd lambda && node --test shared/modelSelection.test.js
```

Expected: PASS — all tests, including the pre-existing `loadModelPair` tests (regression: those profiles have no `qualityScore`, so behavior is unchanged).

- [ ] **Step 6: Commit**

```bash
git add lambda/shared/modelSelection.js lambda/shared/modelSelection.test.js
git commit -m "feat(lambda): rank reference clips by audio quality when scores are cached"
```

---

## Task 8: Add the audio-quality ranking branch to the client scorer (TDD)

**Files:**
- Modify: `client/src/lib/referenceSelection.js:38-107` (`langScore` helper, `scoreReferenceClip`, dynamic reason)
- Test: `client/src/lib/referenceSelection.test.js`

Same logic as Task 7, in the client copy that powers the "Use best" button. Client tests run with `node --test` directly (the package has no test script but is `type: module`).

- [ ] **Step 1: Write the failing tests**

Append to `client/src/lib/referenceSelection.test.js`:

```js
test('chooseBestReferenceSet ranks by audio quality score when present', () => {
  const result = chooseBestReferenceSet([
    { filename: 'a_0_1.wav', path: 'd/a_0_1.wav', transcript: 'A clear sentence here for the reference.', lang: 'en', qualityScore: 40 },
    { filename: 'b_1_2.wav', path: 'd/b_1_2.wav', transcript: 'Another clear sentence here for reference.', lang: 'en', qualityScore: 85 },
    { filename: 'c_2_3.wav', path: 'd/c_2_3.wav', transcript: 'Yet another clear sentence for the reference.', lang: 'en', qualityScore: 60 },
  ], { maxAux: 2 });

  assert.equal(result.primary.filename, 'b_1_2.wav');
  assert.deepEqual(result.aux.map((file) => file.filename), ['c_2_3.wav', 'a_0_1.wav']);
  assert.match(result.reason, /quality/i);
});

test('chooseBestReferenceSet transcript guard avoids an empty-transcript primary', () => {
  const result = chooseBestReferenceSet([
    { filename: 'pristine_empty.wav', path: 'd/pristine_empty.wav', transcript: '', lang: 'en', qualityScore: 85 },
    { filename: 'good_text.wav', path: 'd/good_text.wav', transcript: 'This is a perfectly usable reference sentence for cloning.', lang: 'en', qualityScore: 75 },
  ], { maxAux: 1 });

  assert.equal(result.primary.filename, 'good_text.wav');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from repo root):

```bash
node --test client/src/lib/referenceSelection.test.js
```

Expected: the two new tests FAIL — without the audio branch the clips tie on heuristics, alphabetical tiebreak makes `a_0_1.wav`/`pristine_empty.wav` primary, and `result.reason` has no "quality".

- [ ] **Step 3: Add the `langScore` helper**

`referenceSelection.js` has `normalizeLang` at line 38. Add `langScore` right after it:

```js
function langScore(lang = '') {
  const normalized = normalizeLang(lang);
  if (normalized === 'en' || normalized === 'eng') return 14;
  if (normalized === 'auto' || !normalized) return 3;
  return 0;
}
```

- [ ] **Step 4: Add the audio branch and reuse `langScore`**

Replace the body of `scoreReferenceClip` (currently `referenceSelection.js:55-77`):

```js
function scoreReferenceClip(file) {
  const audioScore = Number(file?.qualityScore);
  if (Number.isFinite(audioScore)) {
    // Audio quality dominates; transcript + language guard so the PRIMARY
    // (whose transcript becomes prompt_text) isn't a clean clip with no text.
    return audioScore + 0.3 * (transcriptScore(file?.transcript) + langScore(file?.lang));
  }

  const filename = file?.filename || '';
  const ext = extensionOf(filename);

  let score = transcriptScore(file?.transcript);

  if (GOOD_AUDIO_EXTENSIONS.has(ext)) score += 18;
  else if (OK_AUDIO_EXTENSIONS.has(ext)) score += 6;

  score += langScore(file?.lang);

  if (GOOD_NAME_RE.test(filename)) score += 14;
  if (/(^|[_\-\s])(reference|ref)([_\-\s]|\d|$)/i.test(filename)) score += 8;
  if (/(^|[_\-\s])(aux|auxiliary)([_\-\s]|\d|$)/i.test(filename)) score -= 4;
  if (RISKY_NAME_RE.test(filename)) score -= 32;

  // Prefer clips in the ideal reference-length window over chronologically-first ones.
  score += durationScore(filename);

  return score;
}
```

(The old `lang` local and its two `score +=` lines are removed; `durationScore` is kept in the fallback only — the audio score already accounts for duration.)

- [ ] **Step 5: Make the reason reflect which signal was used**

`chooseBestReferenceSet` currently returns a fixed `reason`. After the `ranked` array is built and before the `return`, detect whether scores were used and choose the message. Replace the final `return { primary, aux, reason: '…' };` block (`referenceSelection.js:99-106`):

```js
  const primary = ranked[0].file;
  const aux = ranked.slice(1, maxAux + 1).map((entry) => entry.file);

  const usedQualityScores = ranked.some(
    (entry) => Number.isFinite(Number(entry.file?.qualityScore)),
  );
  const reason = usedQualityScores
    ? 'Auto-picked by measured audio quality (SNR, clarity, duration), with a transcript/language tie-break.'
    : 'Auto-picked from clip length (~3-9s ideal), transcript quality, language, file type, and clean-reference filename hints.';

  return { primary, aux, reason };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (from repo root):

```bash
node --test client/src/lib/referenceSelection.test.js
```

Expected: PASS — including the pre-existing heuristic test (its files have no `qualityScore`, so it still gets the `/transcript/i` reason and the same ordering).

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/referenceSelection.js client/src/lib/referenceSelection.test.js
git commit -m "feat(client): rank 'Use best' reference clips by audio quality when scores exist"
```

---

## Task 9: Add S3 listing/existence helpers for the backfill script

**Files:**
- Modify: `gpu-worker/src/services/s3Sync.js:1-23` (imports/helpers) and end of file

The backfill needs to (a) enumerate dataset folders and (b) skip ones already scored. Add two small exported helpers to the existing module so `S3_PREFIX` handling stays centralized.

- [ ] **Step 1: Import the needed commands**

The first import line in `gpu-worker/src/services/s3Sync.js` is:

```js
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
```

Add `HeadObjectCommand`:

```js
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
```

- [ ] **Step 2: Append the two helpers at the end of the file**

```js
// Lists the immediate "subdirectory" names under an S3 prefix (one level deep)
// using a delimiter, e.g. listSubPrefixes('training/datasets/') → ['lecturer-a', …].
export async function listSubPrefixes(s3Prefix) {
  const base = fullKey(s3Prefix);
  const names = [];
  let continuationToken;
  do {
    const response = await getClient().send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: base,
      Delimiter: '/',
      ContinuationToken: continuationToken,
    }));
    for (const cp of response.CommonPrefixes || []) {
      const name = cp.Prefix.slice(base.length).replace(/\/+$/, '');
      if (name) names.push(name);
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return names;
}

// Returns true if an object exists at the given (prefix-relative) key.
export async function objectExists(key) {
  try {
    await getClient().send(new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: fullKey(key),
    }));
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Syntax check**

Run:

```bash
node --check gpu-worker/src/services/s3Sync.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add gpu-worker/src/services/s3Sync.js
git commit -m "feat(gpu-worker): add listSubPrefixes and objectExists S3 helpers"
```

---

## Task 10: Create the backfill script for existing voices

**Files:**
- Create: `gpu-worker/scripts/backfill-clip-scores.mjs`

Run on the gpu-worker / EC2 box (Python + librosa + S3 creds). Downloads a voice's denoised clips, scores them with `score_clips.py`, uploads `clip-scores.json`.

- [ ] **Step 1: Write the script**

Create `gpu-worker/scripts/backfill-clip-scores.mjs`:

```js
#!/usr/bin/env node
// Backfill clip-scores.json for voices trained before quality scoring existed.
//
//   node scripts/backfill-clip-scores.mjs <exp>     # one voice
//   node scripts/backfill-clip-scores.mjs --all     # every dataset missing a cache
//
// Runs on the gpu-worker box (needs PYTHON_EXEC with librosa + S3 credentials).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

import { PYTHON_EXEC, SCRIPTS } from '../src/config.js';
import {
  downloadPrefix,
  uploadFile,
  listSubPrefixes,
  objectExists,
} from '../src/services/s3Sync.js';

const DATASETS_PREFIX = 'training/datasets/';

function runScoreClips(denoisedDir, outPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_EXEC, [SCRIPTS.scoreClips, denoisedDir, '--json', outPath], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`score_clips.py exited with code ${code}`));
    });
  });
}

async function backfillOne(expName) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `clipscores-${expName}-`));
  const outPath = path.join(tempDir, 'clip-scores.json');
  try {
    const downloaded = await downloadPrefix(`${DATASETS_PREFIX}${expName}/denoised/`, tempDir);
    if (downloaded === 0) {
      console.warn(`[skip] ${expName}: no denoised clips found`);
      return false;
    }
    await runScoreClips(tempDir, outPath);
    if (!fs.existsSync(outPath)) {
      console.warn(`[skip] ${expName}: score_clips.py produced no output`);
      return false;
    }
    await uploadFile(outPath, `${DATASETS_PREFIX}${expName}/clip-scores.json`);
    console.log(`[ok]   ${expName}: clip-scores.json uploaded`);
    return true;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/backfill-clip-scores.mjs <exp> | --all');
    process.exit(1);
  }

  let targets;
  if (arg === '--all') {
    const all = await listSubPrefixes(DATASETS_PREFIX);
    targets = [];
    for (const exp of all) {
      if (await objectExists(`${DATASETS_PREFIX}${exp}/clip-scores.json`)) {
        console.log(`[have] ${exp}: already scored, skipping`);
        continue;
      }
      targets.push(exp);
    }
  } else {
    targets = [arg];
  }

  let ok = 0;
  for (const exp of targets) {
    try {
      if (await backfillOne(exp)) ok += 1;
    } catch (err) {
      console.error(`[fail] ${exp}: ${err.message}`);
    }
  }
  console.log(`Done. Scored ${ok}/${targets.length} voice(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Syntax check**

Run:

```bash
node --check gpu-worker/scripts/backfill-clip-scores.mjs
```

Expected: no output, exit code 0.

- [ ] **Step 3: Verify the usage guard (no env needed)**

Run (from `gpu-worker/`):

```bash
cd gpu-worker && node scripts/backfill-clip-scores.mjs
```

Expected: prints `Usage: node scripts/backfill-clip-scores.mjs <exp> | --all` and exits non-zero. (A real run requires S3 creds + Python/librosa on the gpu-worker box; that is the manual verification below.)

- [ ] **Step 4: Manual verification note**

On the gpu-worker/EC2 box with S3 credentials configured, run the backfill for the screenshot voice (`node scripts/backfill-clip-scores.mjs <exp>`), then confirm `training/datasets/<exp>/clip-scores.json` exists in S3 and that reopening the Live Gateway for that voice now selects clips ordered by quality rather than chronologically. Record as a manual check.

- [ ] **Step 5: Commit**

```bash
git add gpu-worker/scripts/backfill-clip-scores.mjs
git commit -m "feat(gpu-worker): add backfill-clip-scores script for existing voices"
```

---

## Final verification

- [ ] **Run the full lambda test suite**

```bash
cd lambda && node --test "**/*.test.js"
```

Expected: PASS, including `clipScores.test.js` and `modelSelection.test.js`.

- [ ] **Run the client reference-selection tests**

```bash
node --test client/src/lib/referenceSelection.test.js
```

Expected: PASS (original heuristic test + the two new audio-quality tests).

- [ ] **Confirm no behavioral change without a cache**

The pre-existing tests (`loadModelPair` profiles, the original `chooseBestReferenceSet` heuristic test) pass unchanged — proving voices with no `clip-scores.json` rank exactly as before.

---

## Notes for the implementer

- **Order matters:** Task 4 (the shared helper) must land before Tasks 5 and 6, which import it. Tasks 7 and 8 are independent of each other. Task 9 must land before Task 10. Otherwise tasks are self-contained.
- **DRY caveat:** `lambda/shared/modelSelection.js` and `client/src/lib/referenceSelection.js` are deliberate near-duplicates (different runtimes — Node Lambda vs. browser bundle). Do not try to merge them into one module; apply the same change to both (Tasks 7 and 8).
- **Why `qualityScore: undefined` is safe:** every scorer gates on `Number.isFinite(Number(file.qualityScore))`. `undefined`/missing → `NaN` → not finite → heuristic fallback. No need to conditionally omit the field.
- **Scores are keyed by basename:** `score_clips.py` writes `os.path.basename(path)` as keys, and every lister keys clips by basename too, so `scores.get(filename)` lines up.
