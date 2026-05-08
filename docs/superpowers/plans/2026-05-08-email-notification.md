# Email Notification & Pipeline UI Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email notification on training completion, remove the pipeline visualization from the training page, and auto-select the trained voice on the inference page when the user arrives via the email deep-link.

**Architecture:** Email address flows from the training form → Lambda `/api/train` → GPU worker `/train` → stored in session → sent via AWS SES when `pipeline.js` marks training complete. The email contains a deep-link with `?voice=expName`; the inference page reads this URL param and auto-selects the matching voice profile.

**Tech Stack:** AWS SDK v3 `@aws-sdk/client-ses` (GPU worker), Node.js built-in test runner (`node --test`), React 18 / hooks (client)

---

## File Map

**New files:**
- `gpu-worker/src/services/emailService.js` — SES email sender (dependency-injected for testability)
- `gpu-worker/src/services/emailService.test.js` — unit tests with mock SES client

**Modified files:**
- `client/src/lib/trainingValidation.js` — add `email` required field validation
- `client/src/lib/trainingValidation.test.js` — update existing tests + add email cases
- `lambda/training/index.js` — extract and forward `email` to GPU worker
- `lambda/training/index.test.js` — update existing test to assert email is forwarded
- `gpu-worker/package.json` — add `@aws-sdk/client-ses`
- `gpu-worker/src/config.js` — export `SES_FROM_EMAIL`
- `gpu-worker/.env.gpuworker.deployment` — document `SES_FROM_EMAIL`
- `gpu-worker/src/routes/training.js` — accept `email`, store in session, pass to `runPipelineWithS3`
- `gpu-worker/src/services/pipeline.js` — accept `email` param, call `sendTrainingCompleteEmail` after complete
- `client/src/pages/TrainingPage.jsx` — email input, start button moved, pipeline card removed
- `client/src/pages/InferencePage.jsx` — URL param auto-select on mount

---

## Task 1: Email validation in trainingValidation.js

**Files:**
- Modify: `client/src/lib/trainingValidation.js`
- Modify: `client/src/lib/trainingValidation.test.js`

- [ ] **Step 1: Update existing tests to pass `email` and add new email validation cases**

Replace the entire contents of `client/src/lib/trainingValidation.test.js` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTrainingStart } from './trainingValidation.js';

const wavFile = { name: 'voice_sample.wav', type: 'audio/wav', size: 8 * 1024 * 1024 };
const validEmail = 'user@example.com';

test('validateTrainingStart accepts a named run with supported audio, bounded settings, and valid email', () => {
  const result = validateTrainingStart({
    expName: 'demo_voice_01',
    email: validEmail,
    files: [wavFile],
    batchSize: 2,
    sovitsEpochs: 20,
    gptEpochs: 25,
    sovitsSaveEvery: 4,
    gptSaveEvery: 5,
    asrLanguage: 'en',
  });

  assert.deepEqual(result, { valid: true, errors: [] });
});

test('validateTrainingStart rejects missing or unsafe experiment names before upload', () => {
  assert.deepEqual(validateTrainingStart({ expName: '', email: validEmail, files: [wavFile] }), {
    valid: false,
    errors: ['Enter an experiment name.'],
  });

  assert.deepEqual(validateTrainingStart({ expName: '../voice', email: validEmail, files: [wavFile] }), {
    valid: false,
    errors: ['Experiment name may only contain letters, numbers, dots, dashes, and underscores.'],
  });
});

test('validateTrainingStart rejects empty or unsupported training audio input', () => {
  assert.deepEqual(validateTrainingStart({ expName: 'voice', email: validEmail, files: [] }), {
    valid: false,
    errors: ['Upload at least one training audio file.'],
  });

  assert.deepEqual(validateTrainingStart({
    expName: 'voice',
    email: validEmail,
    files: [{ name: 'notes.txt', type: 'text/plain', size: 100 }],
  }), {
    valid: false,
    errors: ['Unsupported audio file: notes.txt. Use WAV, FLAC, MP3, M4A, OGG, WEBM, or MP4.'],
  });
});

test('validateTrainingStart rejects out-of-range training settings', () => {
  const result = validateTrainingStart({
    expName: 'voice',
    email: validEmail,
    files: [wavFile],
    batchSize: 0,
    sovitsEpochs: 0,
    gptEpochs: 51,
    sovitsSaveEvery: 11,
    gptSaveEvery: 0,
    asrLanguage: 'pirate',
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    'Batch size must be between 1 and 4.',
    'SoVITS epochs must be between 1 and 50.',
    'GPT epochs must be between 1 and 50.',
    'SoVITS save interval must be between 1 and 10.',
    'GPT save interval must be between 1 and 10.',
    'ASR language must be English, Chinese, Japanese, Korean, or Auto Detect.',
  ]);
});

test('validateTrainingStart rejects missing email', () => {
  assert.deepEqual(validateTrainingStart({ expName: 'voice', email: '', files: [wavFile] }), {
    valid: false,
    errors: ['Enter a valid email address to receive training notifications.'],
  });
});

test('validateTrainingStart rejects malformed email addresses', () => {
  const result = validateTrainingStart({ expName: 'voice', email: 'notanemail', files: [wavFile] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['Enter a valid email address to receive training notifications.']);
});

test('validateTrainingStart accepts email with subdomain and plus addressing', () => {
  const result = validateTrainingStart({
    expName: 'voice',
    email: 'user+tag@mail.example.co.uk',
    files: [wavFile],
  });
  assert.deepEqual(result, { valid: true, errors: [] });
});
```

- [ ] **Step 2: Run tests to confirm they fail (email validation not yet implemented)**

```
cd "C:\Internship\Webapp VoiceCloning\client"
node --test "src/lib/trainingValidation.test.js"
```

Expected: tests that assert email errors fail because the current `validateTrainingStart` does not validate email.

- [ ] **Step 3: Add email validation to trainingValidation.js**

Replace the entire contents of `client/src/lib/trainingValidation.js` with:

```js
const SAFE_EXP_NAME_RE = /^[A-Za-z0-9._-]+$/u;
const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.wav', '.flac', '.mp3', '.m4a', '.ogg', '.webm', '.mp4']);
const SUPPORTED_ASR_LANGUAGES = new Set(['en', 'zh', 'ja', 'ko', 'auto']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function extensionOf(filename = '') {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

function isIntegerInRange(value, min, max) {
  return Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
}

export function validateTrainingStart({
  expName = '',
  email = '',
  files = [],
  batchSize = 2,
  sovitsEpochs = 20,
  gptEpochs = 25,
  sovitsSaveEvery = 4,
  gptSaveEvery = 5,
  asrLanguage = 'en',
} = {}) {
  const errors = [];
  const cleanName = String(expName || '').trim();

  if (!cleanName) {
    errors.push('Enter an experiment name.');
  } else if (!SAFE_EXP_NAME_RE.test(cleanName)) {
    errors.push('Experiment name may only contain letters, numbers, dots, dashes, and underscores.');
  }

  const cleanEmail = String(email || '').trim();
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
    errors.push('Enter a valid email address to receive training notifications.');
  }

  const fileList = Array.from(files || []);
  if (fileList.length === 0) {
    errors.push('Upload at least one training audio file.');
  } else {
    const unsupported = fileList.find((file) => !SUPPORTED_AUDIO_EXTENSIONS.has(extensionOf(file?.name || '')));
    if (unsupported) {
      errors.push(`Unsupported audio file: ${unsupported.name || 'unknown file'}. Use WAV, FLAC, MP3, M4A, OGG, WEBM, or MP4.`);
    }
  }

  if (!isIntegerInRange(batchSize, 1, 4)) {
    errors.push('Batch size must be between 1 and 4.');
  }
  if (!isIntegerInRange(sovitsEpochs, 1, 50)) {
    errors.push('SoVITS epochs must be between 1 and 50.');
  }
  if (!isIntegerInRange(gptEpochs, 1, 50)) {
    errors.push('GPT epochs must be between 1 and 50.');
  }
  if (!isIntegerInRange(sovitsSaveEvery, 1, 10)) {
    errors.push('SoVITS save interval must be between 1 and 10.');
  }
  if (!isIntegerInRange(gptSaveEvery, 1, 10)) {
    errors.push('GPT save interval must be between 1 and 10.');
  }
  if (!SUPPORTED_ASR_LANGUAGES.has(String(asrLanguage || '').trim())) {
    errors.push('ASR language must be English, Chinese, Japanese, Korean, or Auto Detect.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
```

- [ ] **Step 4: Run tests and confirm all pass**

```
cd "C:\Internship\Webapp VoiceCloning\client"
node --test "src/lib/trainingValidation.test.js"
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```
git add client/src/lib/trainingValidation.js client/src/lib/trainingValidation.test.js
git commit -m "feat: add email validation to training start validation"
```

---

## Task 2: Lambda training handler — forward email to GPU worker

**Files:**
- Modify: `lambda/training/index.js`
- Modify: `lambda/training/index.test.js`

- [ ] **Step 1: Update the existing test to assert email is forwarded, and add a second case**

Replace the contents of `lambda/training/index.test.js` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from './index.js';

test('training handler forwards start requests to the GPU worker with nested config and email', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  process.env.GPU_WORKER_URL = 'http://gpu-worker.local:3001';
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ sessionId: 'worker-session', steps: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const response = await handler({
      requestContext: { http: { method: 'POST' } },
      rawPath: '/api/train',
      body: JSON.stringify({
        expName: 'demo',
        email: 'user@test.com',
        batchSize: 2,
        sovitsEpochs: 4,
        gptEpochs: 3,
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { sessionId: 'worker-session', steps: [] });
    assert.equal(calls[0].url, 'http://gpu-worker.local:3001/train');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      expName: 'demo',
      email: 'user@test.com',
      config: {
        batchSize: 2,
        sovitsEpochs: 4,
        gptEpochs: 3,
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('training handler forwards start requests without email when email is omitted', async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  process.env.GPU_WORKER_URL = 'http://gpu-worker.local:3001';
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ sessionId: 'worker-session', steps: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await handler({
      requestContext: { http: { method: 'POST' } },
      rawPath: '/api/train',
      body: JSON.stringify({ expName: 'demo' }),
    });

    const sentBody = JSON.parse(calls[0].options.body);
    assert.equal(sentBody.expName, 'demo');
    assert.equal(sentBody.email, undefined);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('training current returns idle when the GPU worker is not reachable', async () => {
  const previousFetch = globalThis.fetch;
  process.env.GPU_WORKER_URL = 'http://localhost:3999';
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  try {
    const response = await handler({
      requestContext: { http: { method: 'GET' } },
      rawPath: '/api/train/current',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      sessionId: null,
      status: 'idle',
      steps: [],
      logs: [],
      workerAvailable: false,
      message: 'fetch failed',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
```

- [ ] **Step 2: Run tests to confirm the email forwarding test fails**

```
cd "C:\Internship\Webapp VoiceCloning\lambda"
node --test "training/index.test.js"
```

Expected: first test fails because `email` is not yet forwarded.

- [ ] **Step 3: Update lambda/training/index.js to extract and forward email**

Replace the contents of `lambda/training/index.js` with:

```js
import { gpuPost, gpuGet } from '../shared/gpuWorker.js';
import { isSafePathSegment } from '../shared/paths.js';
import { ok, err, preflight, parseJsonBody } from '../shared/cors.js';

function isWorkerUnavailableError(error) {
  const message = error?.message || '';
  return error instanceof TypeError
    || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|GPU_WORKER_URL env var/u.test(message);
}

export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return preflight();
  }

  const method = event.requestContext?.http?.method;
  const routePath = event.rawPath || '';
  let body = {};
  if (method === 'POST') {
    try {
      body = parseJsonBody(event);
    } catch {
      return err(400, 'Invalid JSON body');
    }
  }

  try {
    if (method === 'POST' && routePath.endsWith('/train/stop')) {
      const { sessionId } = body;
      if (!sessionId) return err(400, 'sessionId is required');
      return ok(await gpuPost('/train/stop', { sessionId }));
    }

    if (method === 'POST' && routePath.endsWith('/train')) {
      const {
        expName,
        email,
        batchSize,
        sovitsEpochs,
        gptEpochs,
        sovitsSaveEvery,
        gptSaveEvery,
        asrLanguage,
        asrModel,
      } = body;
      if (!expName) return err(400, 'expName is required');
      if (!isSafePathSegment(expName)) {
        return err(400, 'expName may only contain letters, numbers, dots, dashes, and underscores');
      }

      return ok(await gpuPost('/train', {
        expName,
        ...(email !== undefined ? { email } : {}),
        config: {
          ...(batchSize !== undefined ? { batchSize } : {}),
          ...(sovitsEpochs !== undefined ? { sovitsEpochs } : {}),
          ...(gptEpochs !== undefined ? { gptEpochs } : {}),
          ...(sovitsSaveEvery !== undefined ? { sovitsSaveEvery } : {}),
          ...(gptSaveEvery !== undefined ? { gptSaveEvery } : {}),
          ...(asrLanguage !== undefined ? { asrLanguage } : {}),
          ...(asrModel !== undefined ? { asrModel } : {}),
        },
      }));
    }

    if (method === 'GET' && routePath.endsWith('/train/current')) {
      try {
        return ok(await gpuGet('/train/current'));
      } catch (error) {
        if (!isWorkerUnavailableError(error)) {
          throw error;
        }
        return ok({
          sessionId: null,
          status: 'idle',
          steps: [],
          logs: [],
          workerAvailable: false,
          message: error.message,
        });
      }
    }

    return err(404, 'Not found');
  } catch (error) {
    return err(500, error.message);
  }
};
```

- [ ] **Step 4: Run tests and confirm all pass**

```
cd "C:\Internship\Webapp VoiceCloning\lambda"
node --test "training/index.test.js"
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```
git add lambda/training/index.js lambda/training/index.test.js
git commit -m "feat: forward email from lambda training handler to GPU worker"
```

---

## Task 3: GPU worker email service

**Files:**
- Modify: `gpu-worker/package.json` — add SES SDK
- Create: `gpu-worker/src/services/emailService.js`
- Create: `gpu-worker/src/services/emailService.test.js`

- [ ] **Step 1: Install @aws-sdk/client-ses**

```
cd "C:\Internship\Webapp VoiceCloning\gpu-worker"
npm install @aws-sdk/client-ses
```

Expected: package installs, `@aws-sdk/client-ses` appears in `gpu-worker/package.json` dependencies.

- [ ] **Step 2: Write the failing test for emailService.js**

Create `gpu-worker/src/services/emailService.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('sendTrainingCompleteEmail sends correct subject and body to SES', async () => {
  const calls = [];
  const mockClient = {
    send: async (command) => {
      calls.push(command.input);
    },
  };

  const { sendTrainingCompleteEmail } = await import('./emailService.js');

  await sendTrainingCompleteEmail('user@example.com', 'my_voice', {
    sesClient: mockClient,
    fromEmail: 'sender@example.com',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].Source, 'sender@example.com');
  assert.deepEqual(calls[0].Destination.ToAddresses, ['user@example.com']);
  assert.ok(calls[0].Message.Subject.Data.includes('my_voice'), 'subject should contain expName');
  assert.ok(calls[0].Message.Body.Text.Data.includes('doovx82fh9tfs.cloudfront.net'), 'text body should contain inference URL');
  assert.ok(calls[0].Message.Body.Text.Data.includes('my_voice'), 'text body should contain expName');
  assert.ok(calls[0].Message.Body.Html.Data.includes('doovx82fh9tfs.cloudfront.net'), 'html body should contain inference URL');
  assert.ok(calls[0].Message.Body.Html.Data.includes('my_voice'), 'html body should contain expName');
  assert.ok(
    calls[0].Message.Body.Text.Data.includes('voice=my_voice'),
    'text body should include voice query param'
  );
});

test('sendTrainingCompleteEmail skips silently when fromEmail is not provided', async () => {
  const calls = [];
  const mockClient = {
    send: async (command) => {
      calls.push(command);
    },
  };

  const { sendTrainingCompleteEmail } = await import('./emailService.js');

  await sendTrainingCompleteEmail('user@example.com', 'my_voice', {
    sesClient: mockClient,
    fromEmail: '',
  });

  assert.equal(calls.length, 0);
});
```

- [ ] **Step 3: Run test to confirm it fails (file doesn't exist yet)**

```
cd "C:\Internship\Webapp VoiceCloning\gpu-worker"
node --test "src/services/emailService.test.js"
```

Expected: error — module not found.

- [ ] **Step 4: Create gpu-worker/src/services/emailService.js**

```js
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SES_FROM_EMAIL, S3_REGION } from '../config.js';

const INFERENCE_BASE_URL = 'https://doovx82fh9tfs.cloudfront.net';

export async function sendTrainingCompleteEmail(email, expName, { sesClient, fromEmail } = {}) {
  const sender = fromEmail !== undefined ? fromEmail : SES_FROM_EMAIL;

  if (!sender) {
    console.warn('[gpu-worker] SES_FROM_EMAIL not configured — skipping training complete email');
    return;
  }

  const inferenceUrl = `${INFERENCE_BASE_URL}?voice=${encodeURIComponent(expName)}`;
  const client = sesClient || new SESClient({ region: S3_REGION || 'ap-southeast-1' });

  const plainText = [
    `Training is complete for voice "${expName}".`,
    '',
    'Visit your inference studio here:',
    inferenceUrl,
    '',
  ].join('\n');

  const html = `<p>Training is complete for voice <strong>${expName}</strong>.</p>`
    + `<p>Visit your inference studio here:<br>`
    + `<a href="${inferenceUrl}">${inferenceUrl}</a></p>`;

  await client.send(new SendEmailCommand({
    Source: sender,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: `Your voice model is ready: ${expName}` },
      Body: {
        Text: { Data: plainText },
        Html: { Data: html },
      },
    },
  }));
}
```

- [ ] **Step 5: Run tests and confirm all pass**

```
cd "C:\Internship\Webapp VoiceCloning\gpu-worker"
node --test "src/services/emailService.test.js"
```

Expected: both tests pass.

- [ ] **Step 6: Commit**

```
git add gpu-worker/package.json gpu-worker/package-lock.json gpu-worker/src/services/emailService.js gpu-worker/src/services/emailService.test.js
git commit -m "feat: add GPU worker email service using AWS SES"
```

---

## Task 4: GPU worker config — expose SES_FROM_EMAIL

**Files:**
- Modify: `gpu-worker/src/config.js`
- Modify: `gpu-worker/.env.gpuworker.deployment`

- [ ] **Step 1: Add SES_FROM_EMAIL export to config.js**

In `gpu-worker/src/config.js`, add this line after the existing `export const S3_PREFIX` line (around line 55):

```js
export const SES_FROM_EMAIL = readEnv('SES_FROM_EMAIL');
```

The surrounding context (so you can locate the insertion point):

```js
export const S3_BUCKET = readEnv('S3_BUCKET');
export const S3_REGION = readEnv('S3_REGION');
export const S3_PREFIX = readEnv('S3_PREFIX') || '';
export const SES_FROM_EMAIL = readEnv('SES_FROM_EMAIL');   // ← add this line
export const WORKER_PORT = parseIntegerEnv(readEnv('WORKER_PORT'), 3001);
```

- [ ] **Step 2: Document the new env var in .env.gpuworker.deployment**

Add these lines at the end of `gpu-worker/.env.gpuworker.deployment`:

```
# Email notifications (AWS SES)
# SES_FROM_EMAIL must be verified in the AWS SES console before use.
# SES uses S3_REGION by default; set this only if your SES region differs.
SES_FROM_EMAIL=your-verified-sender@gmail.com
```

- [ ] **Step 3: Commit**

```
git add gpu-worker/src/config.js gpu-worker/.env.gpuworker.deployment
git commit -m "feat: expose SES_FROM_EMAIL in GPU worker config"
```

---

## Task 5: GPU worker training route — accept and store email

**Files:**
- Modify: `gpu-worker/src/routes/training.js`

- [ ] **Step 1: Update training route to accept email and pass it through**

Replace the entire contents of `gpu-worker/src/routes/training.js` with:

```js
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sseManager } from '../services/sseManager.js';
import { processManager } from '../services/processManager.js';
import { runPipelineWithS3, STEPS } from '../services/pipeline.js';
import { trainingState } from '../services/trainingState.js';

const router = Router();
const sessions = new Map();

router.post('/train', (req, res) => {
  const { expName, email = '', config = {} } = req.body;

  if (!expName) {
    return res.status(400).json({ error: 'expName is required' });
  }
  if (sessions.size > 0 || processManager.hasRunningProcesses()) {
    return res.status(409).json({ error: 'A training pipeline is already running' });
  }

  const sessionId = uuidv4();
  const s3Prefix = `training/datasets/${expName}/raw/`;

  sessions.set(sessionId, { expName, email, startedAt: Date.now() });
  trainingState.resetForNewSession({ sessionId, expName });
  sseManager.prepareSession(sessionId);

  res.json({ sessionId, steps: STEPS });

  sseManager.waitForClient(sessionId).then(() => {
    trainingState.setStatus('running');
    return runPipelineWithS3(sessionId, {
      expName,
      email,
      s3Prefix,
      batchSize: config.batchSize,
      sovitsEpochs: config.sovitsEpochs,
      gptEpochs: config.gptEpochs,
      sovitsSaveEvery: config.sovitsSaveEvery,
      gptSaveEvery: config.gptSaveEvery,
      asrLanguage: config.asrLanguage,
      asrModel: config.asrModel,
    });
  }).catch((err) => {
    if (err.message === 'SSE client did not connect in time') {
      trainingState.clear();
      sseManager.clearSession(sessionId);
    } else {
      trainingState.setError(err.message || 'Pipeline failed');
      sseManager.send(sessionId, 'error', { message: err.message || 'Pipeline failed' });
    }
  }).finally(() => {
    sessions.delete(sessionId);
  });
});

router.get('/train/progress/:sessionId', (req, res) => {
  sseManager.addClient(req.params.sessionId, res);
});

router.post('/train/stop', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  const killed = processManager.kill(sessionId);
  if (killed) {
    sseManager.send(sessionId, 'error', { message: 'Training stopped by user' });
  }
  trainingState.clear();
  sseManager.clearSession(sessionId);
  sessions.delete(sessionId);
  res.json({ message: 'Training stopped' });
});

router.get('/train/current', (_req, res) => {
  res.json(trainingState.getState());
});

export default router;
```

- [ ] **Step 2: Commit**

```
git add gpu-worker/src/routes/training.js
git commit -m "feat: GPU worker training route accepts and stores email address"
```

---

## Task 6: GPU worker pipeline — send email on completion

**Files:**
- Modify: `gpu-worker/src/services/pipeline.js`

- [ ] **Step 1: Add email parameter and call sendTrainingCompleteEmail after completion**

At the top of `gpu-worker/src/services/pipeline.js`, add the import for `sendTrainingCompleteEmail` after the existing imports:

```js
import { sendTrainingCompleteEmail } from './emailService.js';
```

The existing import block ends with:
```js
import { recordTrainingLog } from './trainingLogger.js';
```

So the block becomes:
```js
import { recordTrainingLog } from './trainingLogger.js';
import { sendTrainingCompleteEmail } from './emailService.js';
```

- [ ] **Step 2: Add `email` parameter to runPipelineWithS3 signature**

Find the `runPipelineWithS3` function signature (around line 118):

```js
export async function runPipelineWithS3(sessionId, {
  expName,
  s3Prefix: rawAudioPrefix,
  batchSize = 2,
  sovitsEpochs = 8,
  gptEpochs = 15,
  sovitsSaveEvery = 4,
  gptSaveEvery = 5,
  asrLanguage = 'en',
  asrModel = 'large-v3',
}) {
```

Replace it with:

```js
export async function runPipelineWithS3(sessionId, {
  expName,
  email = '',
  s3Prefix: rawAudioPrefix,
  batchSize = 2,
  sovitsEpochs = 8,
  gptEpochs = 15,
  sovitsSaveEvery = 4,
  gptSaveEvery = 5,
  asrLanguage = 'en',
  asrModel = 'large-v3',
}) {
```

- [ ] **Step 3: Call sendTrainingCompleteEmail after training completes**

Find this block near the end of `runPipelineWithS3` (inside the `try` block, after the S3 cleanup):

```js
    trainingState.setStatus('complete');
    sseManager.send(sessionId, 'pipeline-complete', { success: true });
```

Replace it with:

```js
    trainingState.setStatus('complete');
    sseManager.send(sessionId, 'pipeline-complete', { success: true });

    if (email) {
      sendTrainingCompleteEmail(email, expName).catch((emailErr) => {
        console.warn('[gpu-worker] Training complete email failed (non-fatal):', emailErr.message);
      });
    }
```

- [ ] **Step 4: Commit**

```
git add gpu-worker/src/services/pipeline.js
git commit -m "feat: send training complete email via SES after pipeline finishes"
```

---

## Task 7: Training page UI — email input, button move, pipeline card removed

**Files:**
- Modify: `client/src/pages/TrainingPage.jsx`

- [ ] **Step 1: Replace the entire TrainingPage.jsx**

Replace the entire contents of `client/src/pages/TrainingPage.jsx` with:

```jsx
import React, { useEffect, useRef, useState } from 'react';
import AudioUploader from '../components/AudioUploader.jsx';
import FloatingNotice from '../components/FloatingNotice.jsx';
import { getCurrentTraining, uploadFiles, startTraining, stopTraining } from '../services/api.js';
import { useSSE } from '../hooks/useSSE.js';
import { validateTrainingStart } from '@/lib/trainingValidation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronRight, Play, Square, AlertCircle, Activity, AudioLines, Mail } from 'lucide-react';
import Spinner from '../components/Spinner.jsx';
import { cn } from '@/lib/utils';

const NOTICE_TIMEOUT_MS = 4200;

export default function TrainingPage() {
  const [expName, setExpName] = useState('');
  const [email, setEmail] = useState('');
  const [files, setFiles] = useState([]);
  const [batchSize, setBatchSize] = useState(2);
  const [sovitsEpochs, setSovitsEpochs] = useState(20);
  const [gptEpochs, setGptEpochs] = useState(25);
  const [sovitsSaveEvery, setSovitsSaveEvery] = useState(4);
  const [gptSaveEvery, setGptSaveEvery] = useState(5);
  const [asrLanguage, setAsrLanguage] = useState('en');
  const [showSettings, setShowSettings] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [notice, setNotice] = useState(null);

  const { pipelineStatus, error, connect, disconnect, hydrate, reset } = useSSE();
  const restoredSessionRef = useRef(null);
  const noticeTimeoutRef = useRef(null);
  const previousStatusRef = useRef(null);
  const noticesReadyRef = useRef(false);

  const isRunning = pipelineStatus === 'running' || pipelineStatus === 'waiting';
  const statusLabel = pipelineStatus === 'running'
    ? 'Training in progress'
    : pipelineStatus === 'waiting'
      ? 'Waiting for pipeline'
      : pipelineStatus === 'complete'
        ? 'Training complete'
        : pipelineStatus === 'error'
          ? 'Needs attention'
          : pipelineStatus === 'stopped'
            ? 'Stopped'
            : 'Ready to start';

  function showNotice({ title, message = '', tone = 'success' }) {
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
    }

    const id = Date.now();
    setNotice({ id, title, message, tone });
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice((current) => (current?.id === id ? null : current));
    }, NOTICE_TIMEOUT_MS);
  }

  useEffect(() => {
    let ignore = false;

    async function restoreTrainingState() {
      try {
        const res = await getCurrentTraining();
        const current = res.data;
        if (ignore || !current?.sessionId) return;

        setSessionId(current.sessionId);
        setExpName(current.expName || '');

        if (current.sessionId === restoredSessionRef.current) return;

        const nextState = {
          initialLogs: current.logs || [],
          initialSteps: current.steps || [],
          initialStatus: current.status || 'idle',
          initialError: current.error || null,
        };

        if (current.status === 'running' || current.status === 'waiting') {
          connect(current.sessionId, nextState);
        } else {
          disconnect();
          hydrate(nextState);
        }

        restoredSessionRef.current = current.sessionId;
        previousStatusRef.current = current.status || 'idle';
      } catch (err) {
        console.error('Failed to restore training state:', err);
      } finally {
        noticesReadyRef.current = true;
        if (previousStatusRef.current === null) {
          previousStatusRef.current = 'idle';
        }
      }
    }

    restoreTrainingState();

    return () => {
      ignore = true;
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, [connect, disconnect, hydrate]);

  useEffect(() => {
    if (!noticesReadyRef.current) return;

    const previousStatus = previousStatusRef.current;
    if (previousStatus === null) {
      previousStatusRef.current = pipelineStatus;
      return;
    }

    if (pipelineStatus !== previousStatus) {
      if (pipelineStatus === 'complete') {
        showNotice({
          title: 'Training complete',
          message: 'Your checkpoints are ready. Open the inference studio to use your new voice.',
          tone: 'success',
        });
      } else if (pipelineStatus === 'error') {
        showNotice({
          title: 'Training needs attention',
          message: error || 'The pipeline stopped before finishing.',
          tone: 'error',
        });
      }
    }

    previousStatusRef.current = pipelineStatus;
  }, [pipelineStatus, error]);

  async function handleStart() {
    const validation = validateTrainingStart({
      expName,
      email,
      files,
      batchSize,
      sovitsEpochs,
      gptEpochs,
      sovitsSaveEvery,
      gptSaveEvery,
      asrLanguage,
    });
    if (!validation.valid) {
      const message = validation.errors.join(' ');
      setUploadError(message);
      showNotice({
        title: 'Check training setup',
        message,
        tone: 'error',
      });
      return;
    }

    setUploadError(null);

    try {
      setUploading(true);
      await uploadFiles(expName, files);
      setUploading(false);

      const res = await startTraining({
        expName,
        email,
        batchSize,
        sovitsEpochs,
        gptEpochs,
        sovitsSaveEvery,
        gptSaveEvery,
        asrLanguage,
      });

      setSessionId(res.data.sessionId);
      restoredSessionRef.current = res.data.sessionId;
      connect(res.data.sessionId, { initialStatus: 'waiting' });
      showNotice({
        title: 'Training started',
        message: "Training has started — we'll email you when it's done.",
        tone: 'success',
      });
    } catch (err) {
      setUploading(false);
      setUploadError(err.response?.data?.error || err.message);
      showNotice({
        title: 'Training could not start',
        message: err.response?.data?.error || err.message,
        tone: 'error',
      });
    }
  }

  async function handleStop() {
    if (!sessionId) return;
    disconnect();
    reset();
    setSessionId(null);
    restoredSessionRef.current = null;
    showNotice({
      title: 'Training stopped',
      message: 'The current run has been stopped. You can adjust the setup and start again whenever you are ready.',
      tone: 'success',
    });
    try {
      await stopTraining(sessionId);
    } catch (err) {
      console.error('Failed to stop training:', err);
    }
  }

  return (
    <div className="animate-fade-in space-y-8">
      <FloatingNotice notice={notice} onClose={() => setNotice(null)} />

      <section className="relative overflow-hidden rounded-[32px] border border-sky-200/50 bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_38%,#0f766e_100%)] px-6 py-7 text-white shadow-[0_32px_90px_-45px_rgba(15,23,42,0.85)] sm:px-8 lg:px-10">
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(125,211,252,0.35),transparent_55%)]" />
        <div className="absolute -left-16 top-8 h-40 w-40 rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="absolute bottom-0 right-8 h-48 w-48 rounded-full bg-emerald-300/15 blur-3xl" />

        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.85fr)] lg:items-end">
          <div>
            <Badge className="border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-white shadow-none">
              Training Pipeline
            </Badge>
            <h2 className="mt-5 max-w-3xl font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Start here to train a voice model from your clips, your settings, and a clear step-by-step pipeline.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72 sm:text-base">
              Give your run a name, upload the source audio you want to learn from, enter your email, and hit Start Training. We'll notify you when it's done.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Badge className="border border-white/12 bg-white/10 px-3 py-1.5 text-white shadow-none">
                <Activity size={12} className="mr-1.5" />
                {statusLabel}
              </Badge>
              <Badge className="border border-white/12 bg-white/10 px-3 py-1.5 text-white shadow-none">
                Step 1: upload your source clips
              </Badge>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-[24px] border border-white/12 bg-white/10 p-4 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.85)] backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">Experiment</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight">{expName || 'Untitled project'}</p>
              <p className="mt-2 text-sm leading-6 text-white/72">
                {expName ? 'This name helps you find the dataset, checkpoints, and logs for this run later.' : 'Give this run a short name before you start so the checkpoints stay organized.'}
              </p>
            </div>

            <div className="rounded-[24px] border border-white/12 bg-white/8 p-4 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.85)] backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">Status</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight">{isRunning ? 'Training running' : 'Ready to start'}</p>
              <p className="mt-2 text-sm leading-6 text-white/72">
                {isRunning ? "Your voice is being trained. We'll email you when it's ready." : 'Fill in your name, upload clips, and enter your email to get started.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 01 Setup */}
      <Card className="overflow-hidden rounded-[28px] border border-sky-100/80 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-sm">
        <CardHeader className="border-b border-slate-100/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.75))]">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 text-sm font-semibold">
              1
            </Badge>
            <div>
              <CardTitle className="font-display text-2xl">Setup</CardTitle>
              <CardDescription>Name this run, upload your clips, and enter your email to get notified when training is done.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-6 rounded-[24px] border border-slate-200 bg-slate-50/80 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
                <AudioLines size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">Project identity</p>
                <p className="text-sm leading-6 text-slate-500">Start with a simple name so you can recognize this run and its checkpoints later.</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Experiment Name
              </Label>
              <Input
                className="h-12 rounded-2xl border-slate-200 bg-white shadow-sm"
                placeholder="e.g. my_voice_model"
                value={expName}
                onChange={(e) => setExpName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                disabled={isRunning}
              />
              {expName && (
                <p className="font-mono text-xs text-muted-foreground">
                  Letters, numbers, hyphens, underscores only
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Notification Email
              </Label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="email"
                  className="h-12 rounded-2xl border-slate-200 bg-white pl-10 shadow-sm"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isRunning}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                We'll send you an email when your voice model is ready.
              </p>
            </div>

            <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Quick Summary</p>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="grid grid-cols-[auto,minmax(0,1fr)] gap-3">
                  <span>Dataset</span>
                  <span className="min-w-0 text-right font-semibold text-slate-800">{files.length} file{files.length === 1 ? '' : 's'}</span>
                </div>
                <div className="grid grid-cols-[auto,minmax(0,1fr)] gap-3">
                  <span>Status</span>
                  <span className="min-w-0 text-right font-semibold text-slate-800">{statusLabel}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-[24px] border border-slate-200 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(240,249,255,0.74))] p-5">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Training Audio
            </Label>
            <AudioUploader files={files} onFilesChange={setFiles} disabled={isRunning} />
          </div>

          <div className="flex items-center gap-4 lg:col-span-2">
            {!isRunning ? (
              <Button
                onClick={handleStart}
                disabled={uploading || isRunning}
                size="lg"
                className="rounded-2xl shadow-[0_20px_50px_-28px_rgba(14,165,233,0.75)]"
              >
                {uploading ? (
                  <>
                    <Spinner size={14} className="text-primary-foreground" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    Start Training
                  </>
                )}
              </Button>
            ) : (
              <Button variant="destructive" size="lg" className="rounded-2xl" onClick={handleStop}>
                <Square size={14} />
                Stop Training
              </Button>
            )}

            {error && (
              <span className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                {error}
              </span>
            )}
          </div>

          {uploadError && (
            <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive lg:col-span-2">
              <AlertCircle size={16} />
              {uploadError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 02 Configuration */}
      <Card className="overflow-hidden rounded-[28px] border border-sky-100/80 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-sm">
        <CardHeader className="border-b border-slate-100/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.75))]">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 text-sm font-semibold">
              2
            </Badge>
            <div>
              <CardTitle className="font-display text-2xl">Configuration</CardTitle>
              <CardDescription>Choose the language, checkpoint cadence, and training length before you start.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <Collapsible open={showSettings} onOpenChange={setShowSettings}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 rounded-2xl border-slate-200 text-muted-foreground">
                <ChevronRight
                  size={14}
                  className={cn("transition-transform", showSettings && "rotate-90")}
                />
                {showSettings ? 'Hide' : 'Show'} advanced settings
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-x-10">
                {/* Batch Size */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Batch Size</Label>
                    <span className="font-mono text-sm font-semibold">{batchSize}</span>
                  </div>
                  <Slider
                    min={1} max={4} step={1}
                    value={[batchSize]}
                    onValueChange={([v]) => setBatchSize(v)}
                    disabled={isRunning}
                  />
                </div>

                {/* ASR Language */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">ASR Language</Label>
                  <Select value={asrLanguage} onValueChange={setAsrLanguage} disabled={isRunning}>
                    <SelectTrigger className="rounded-2xl border-slate-200 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="zh">Chinese</SelectItem>
                      <SelectItem value="ja">Japanese</SelectItem>
                      <SelectItem value="ko">Korean</SelectItem>
                      <SelectItem value="auto">Auto Detect</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* SoVITS Epochs */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">SoVITS Epochs</Label>
                    <span className="font-mono text-sm font-semibold">{sovitsEpochs}</span>
                  </div>
                  <Slider
                    min={1} max={50} step={1}
                    value={[sovitsEpochs]}
                    onValueChange={([v]) => setSovitsEpochs(v)}
                    disabled={isRunning}
                  />
                </div>

                {/* GPT Epochs */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">GPT Epochs</Label>
                    <span className="font-mono text-sm font-semibold">{gptEpochs}</span>
                  </div>
                  <Slider
                    min={1} max={50} step={1}
                    value={[gptEpochs]}
                    onValueChange={([v]) => setGptEpochs(v)}
                    disabled={isRunning}
                  />
                </div>

                {/* SoVITS Save Interval */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">SoVITS Save Interval</Label>
                    <span className="font-mono text-sm font-semibold">every {sovitsSaveEvery}ep</span>
                  </div>
                  <Slider
                    min={1} max={10} step={1}
                    value={[sovitsSaveEvery]}
                    onValueChange={([v]) => setSovitsSaveEvery(v)}
                    disabled={isRunning}
                  />
                </div>

                {/* GPT Save Interval */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">GPT Save Interval</Label>
                    <span className="font-mono text-sm font-semibold">every {gptSaveEvery}ep</span>
                  </div>
                  <Slider
                    min={1} max={10} step={1}
                    value={[gptSaveEvery]}
                    onValueChange={([v]) => setGptSaveEvery(v)}
                    disabled={isRunning}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```
git add client/src/pages/TrainingPage.jsx
git commit -m "feat: add email input, move start button, remove pipeline visualization"
```

---

## Task 8: Inference page — auto-select voice from URL param

**Files:**
- Modify: `client/src/pages/InferencePage.jsx`

The inference page already has `autoLoadKeyRef` and `autoReferenceProfileRef` refs. We add a new `urlVoiceKeyRef` to store the parsed URL param on mount, then consume it inside the existing profile-selection `useEffect`.

- [ ] **Step 1: Add urlVoiceKeyRef declaration**

In `InferencePage.jsx`, find the block of `useRef` declarations near the top of the component (around lines 100–104):

```js
  const sessionIdRef = useRef(null);
  const restoredSessionRef = useRef(null);
  const noticeTimeoutRef = useRef(null);
  const skipNextCompletionToastRef = useRef(false);
  const autoLoadKeyRef = useRef('');
  const autoReferenceProfileRef = useRef('');
```

Replace it with:

```js
  const sessionIdRef = useRef(null);
  const restoredSessionRef = useRef(null);
  const noticeTimeoutRef = useRef(null);
  const skipNextCompletionToastRef = useRef(false);
  const autoLoadKeyRef = useRef('');
  const autoReferenceProfileRef = useRef('');
  const urlVoiceKeyRef = useRef('');
```

- [ ] **Step 2: Read the URL param on mount**

Find the existing mount `useEffect` (around line 159):

```js
  useEffect(() => {
    restoreDraft();
    restoreReferencePresets();
    fetchModels();
    checkStatus();
    restoreInferenceState();

    return () => {
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, []);
```

Replace it with:

```js
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const voiceParam = params.get('voice');
    if (voiceParam) {
      urlVoiceKeyRef.current = voiceParam.toLowerCase().replace(/[\s_-]+/g, '');
    }

    restoreDraft();
    restoreReferencePresets();
    fetchModels();
    checkStatus();
    restoreInferenceState();

    return () => {
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, []);
```

- [ ] **Step 3: Consume the URL param in the profile-selection useEffect**

Find the existing profile-selection `useEffect` (around lines 331–358):

```js
  useEffect(() => {
    if (!modelsFetched) return;

    const profiles = buildVoiceProfiles(gptModels, sovitsModels);

    if (profiles.length === 0) {
      if (selectedPersonKey) {
        setSelectedPersonKey('');
      }
      return;
    }

    const selectionStillValid = profiles.some(
      profile => profile.key === selectedPersonKey && profile.complete
    );

    if (!selectionStillValid) {
      const loadedMatch = profiles.find(
        profile => profile.complete
          && profile.gptModel?.path === loadedGPTPath
          && profile.sovitsModel?.path === loadedSoVITSPath
      );
      const fallback = loadedMatch || profiles.find(profile => profile.complete) || profiles[0];
      if (fallback?.key && fallback.key !== selectedPersonKey) {
        setSelectedPersonKey(fallback.key);
      }
    }
  }, [modelsFetched, gptModels, sovitsModels, selectedPersonKey, loadedGPTPath, loadedSoVITSPath]);
```

Replace it with:

```js
  useEffect(() => {
    if (!modelsFetched) return;

    const profiles = buildVoiceProfiles(gptModels, sovitsModels);

    if (profiles.length === 0) {
      if (selectedPersonKey) {
        setSelectedPersonKey('');
      }
      return;
    }

    // Auto-select from email deep-link (?voice=expName) — consumed once
    if (urlVoiceKeyRef.current) {
      const targetKey = urlVoiceKeyRef.current;
      urlVoiceKeyRef.current = '';
      const match = profiles.find(p => p.key === targetKey);
      if (match) {
        setSelectedPersonKey(match.key);
        showNotice({
          title: `Voice "${match.displayName}" selected`,
          message: 'Loading model — this may take a moment.',
          tone: 'success',
        });
        return;
      }
      showNotice({
        title: 'Voice not found yet',
        message: `"${targetKey}" may still be uploading to S3. Refresh in a moment.`,
        tone: 'error',
      });
    }

    const selectionStillValid = profiles.some(
      profile => profile.key === selectedPersonKey && profile.complete
    );

    if (!selectionStillValid) {
      const loadedMatch = profiles.find(
        profile => profile.complete
          && profile.gptModel?.path === loadedGPTPath
          && profile.sovitsModel?.path === loadedSoVITSPath
      );
      const fallback = loadedMatch || profiles.find(profile => profile.complete) || profiles[0];
      if (fallback?.key && fallback.key !== selectedPersonKey) {
        setSelectedPersonKey(fallback.key);
      }
    }
  }, [modelsFetched, gptModels, sovitsModels, selectedPersonKey, loadedGPTPath, loadedSoVITSPath]);
```

Note: the existing auto-load `useEffect` (around line 391) already calls `handleLoadModels({ auto: true })` when `selectedPersonKey` changes and `serverReady` is true — so no extra load wiring is needed.

- [ ] **Step 4: Commit**

```
git add client/src/pages/InferencePage.jsx
git commit -m "feat: auto-select trained voice on inference page from email deep-link"
```

---

## Deployment Checklist (manual steps before going live)

- [ ] Verify sender Gmail in AWS SES Console → Verified identities → Add email address → click confirmation link in inbox
- [ ] Add `ses:SendEmail` permission to the GPU worker EC2 instance's IAM role
- [ ] Set `SES_FROM_EMAIL=your-verified-gmail@gmail.com` in the GPU worker environment (EC2 instance env or `.env` file)
- [ ] Deploy updated GPU worker (includes new `emailService.js` and SES SDK)
- [ ] Deploy updated Lambda training function
- [ ] Deploy updated client build (`npm run build:training` for the training CloudFront)
- [ ] Rebuild and deploy the live-fast/inference client (`npm run build:live-fast`) so the inference page has the auto-select change
