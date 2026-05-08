# Email Notification & Pipeline UI Cleanup — Design Spec

**Date:** 2026-05-08  
**Status:** Approved

---

## Overview

Three coupled changes to the Voice Cloning Studio:

1. **Email notification** — users enter their email on the training page; when training completes the GPU worker sends a notification email via AWS SES with a deep-link to the inference CloudFront.
2. **Pipeline UI removal** — the technical 8-step pipeline visualization is removed from the training page; the Start Training button moves into the Setup card.
3. **Inference auto-select** — when a user visits the inference CloudFront via the email deep-link, their trained voice is automatically selected and loaded.

---

## Architecture & Data Flow

```
TrainingPage (email input)
  → api.js startTraining({ ..., email })
  → Lambda /api/train (forwards email → GPU worker)
  → GPU worker POST /train (stores email in session map with expName)
  → pipeline.js completes
      → sendTrainingCompleteEmail(email, expName)
      → AWS SES → user's inbox
```

Email deep-link format: `https://doovx82fh9tfs.cloudfront.net?voice=<expName>`

---

## Feature 1: Email Notification

### Frontend — `client/src/pages/TrainingPage.jsx`

- Add `email` state (`useState('')`)
- Add email input field in Setup card (Card #1), below the Experiment Name field
  - Label: "Notification Email"
  - Placeholder: "you@example.com"
  - Disabled while `isRunning`
  - Validated as a proper email format in `handleStart()` — training cannot start without a valid email
- Pass `email` to `startTraining({ expName, batchSize, ..., email })`
- Update the "Training started" floating notice message to: *"Training has started — we'll email you when it's done."*

### Frontend — `client/src/lib/trainingValidation.js`

- Add email to the validated fields
- Reject empty or malformed email addresses with a clear error message

### Frontend — `client/src/services/api.js`

- `startTraining(params)` already forwards the full params object — no change needed; email is included automatically.

### Lambda — `lambda/training/index.js`

- Extract `email` from the POST body alongside `expName` and `config`
- Forward `email` in the GPU worker `/train` POST payload

### GPU Worker — `gpu-worker/src/routes/training.js`

- Accept `email` from the request body
- Store `email` in the `sessions` map: `sessions.set(sessionId, { expName, email, startedAt: Date.now() })`
- Pass `email` to `runPipelineWithS3()` as a named parameter

### GPU Worker — `gpu-worker/src/services/pipeline.js`

- `runPipelineWithS3()` accepts `email` as a new parameter (defaults to `''`)
- After `trainingState.setStatus('complete')` and `sseManager.send(...)`, call:
  ```js
  if (email) {
    await sendTrainingCompleteEmail(email, expName).catch(err => {
      console.warn('[gpu-worker] Email send failed (non-fatal):', err.message);
    });
  }
  ```
- Email failure is non-fatal — training success is not rolled back

### GPU Worker — `gpu-worker/src/services/emailService.js` (new file)

```
sendTrainingCompleteEmail(email, expName)
  - Reads SES_FROM_EMAIL from env (warns and returns early if missing)
  - Reads S3_REGION (reuses existing env) for SES client region
  - Sends via @aws-sdk/client-ses SendEmailCommand
  - Subject: "Your voice model is ready: <expName>"
  - Plain-text body:
      Training is complete for voice "<expName>".
      Visit your inference studio here:
      https://doovx82fh9tfs.cloudfront.net?voice=<expName>
  - HTML body: same content, link rendered as <a> tag
```

### GPU Worker — `package.json`

- Add `@aws-sdk/client-ses` to dependencies

### GPU Worker — `.env.gpuworker.deployment`

Add documentation for two new env vars:
```
SES_FROM_EMAIL=no-reply@yourdomain.com   # Must be SES-verified
SES_REGION=ap-southeast-1               # Defaults to S3_REGION if omitted
```

### AWS Prerequisites (manual, before deploy)

1. Go to AWS SES Console → Verified identities → Add email address → enter sender Gmail → click confirmation link
2. Add `ses:SendEmail` permission to the GPU worker EC2 instance's IAM role

---

## Feature 2: Pipeline UI Removal

### `client/src/pages/TrainingPage.jsx`

**Remove:**
- Entire Card #3 (Pipeline): `ProgressTracker`, step stats badges (Progress/Batch/Language/View chips), Start/Stop buttons, error display inside that card
- Hero section badge: `"Step 2: review the 8-stage pipeline"`
- Import of `ProgressTracker` component (if no longer used elsewhere)
- Import of `ChevronRight` from lucide if only used in pipeline card

**Add to Setup card (Card #1):**
- Start Training / Stop Training button block (same logic as before) placed after the audio uploader and email input, inside the right column or as a full-width row at the bottom of the card content
- Error display (the `uploadError` red banner) remains below the button

**Remove state no longer needed:**
- `completedSteps` (derived from steps, only used in pipeline card)

**Keep unchanged:**
- `steps`, `pipelineStatus`, `error` — still needed for SSE state and the status label shown in the hero section and Setup card summary
- The `statusLabel` display in the hero section "Current Focus" card

---

## Feature 3: Inference Auto-Select

### `client/src/pages/InferencePage.jsx`

**On mount (inside the existing `useEffect([], [])`):**

```js
const params = new URLSearchParams(window.location.search);
const voiceParam = params.get('voice');
if (voiceParam) {
  autoLoadKeyRef.current = voiceParam.toLowerCase().replace(/[\s_-]+/g, '');
}
```

**After `fetchModels()` resolves (or in a `useEffect` on `[voiceProfiles, modelsFetched]`):**

```js
if (!autoLoadKeyRef.current || !modelsFetched) return;
const match = voiceProfiles.find(p => p.key === autoLoadKeyRef.current);
if (!match) {
  showNotice({
    title: 'Voice not found yet',
    message: `"${voiceParam}" may still be uploading. Refresh in a moment.`,
    tone: 'error',
  });
  autoLoadKeyRef.current = '';
  return;
}
setSelectedPersonKey(match.key);
autoReferenceProfileRef.current = match.key;
showNotice({
  title: `Voice "${match.displayName}" selected`,
  message: 'Loading model — this may take a moment.',
  tone: 'success',
});
autoLoadKeyRef.current = '';
```

**Auto-load trigger (in the `useEffect` on `[serverReady, modelsFetched]` or after profile selection):**

Once a profile is selected via auto-select and `serverReady` is true, call `handleLoadModel()` (the existing load function) automatically. If `serverReady` is false, set a flag (`pendingAutoLoad`) and trigger load when `serverReady` flips to `true`.

**Behavior summary:**
- URL param consumed once on first read, flag cleared after use
- If no matching profile: notice shown, no crash
- If GPU not ready: auto-load deferred until ready
- Normal user flow (no URL param): unchanged

---

## Out of Scope

- Email unsubscribe / preferences
- Multiple recipients
- Rich HTML email template beyond basic styling
- Storing email address for future sessions
- SES domain verification (single email verify is sufficient for testing)

---

## Deployment Checklist

- [ ] Verify sender Gmail in AWS SES Console
- [ ] Add `ses:SendEmail` to GPU worker EC2 IAM role
- [ ] Set `SES_FROM_EMAIL` in GPU worker env
- [ ] Deploy updated GPU worker
- [ ] Deploy updated Lambda (training function)
- [ ] Deploy updated client build
