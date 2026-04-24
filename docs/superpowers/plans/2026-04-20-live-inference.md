# Live Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/live` page where the user holds a push-to-talk button, speaks, and hears their words played back in the currently-loaded cloned voice.

**Architecture:** Browser records audio via MediaRecorder on button hold; on release, the blob is uploaded to a new `POST /api/live/upload` endpoint, then chained through existing `/api/transcribe` → `/api/inference/generate` → SSE → `/api/inference/result` → auto-play. The Live page resolves reference audio from the last inference session (server state) or localStorage fallback.

**Tech Stack:** Node.js/Express + multer (server), React 18 + shadcn/ui + Tailwind (client), MediaRecorder API, existing `useInferenceSSE` hook.

> **Note:** This project has no automated test suite. Verification steps are manual — follow them exactly as written.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server/src/routes/upload.js` | Modify | Add `POST /api/live/upload` handler |
| `client/src/services/api.js` | Modify | Add `removedLiveAudioUpload()` helper |
| `client/src/pages/LivePage.jsx` | Create | Full live-mode page |
| `client/src/App.jsx` | Modify | Register `/live` route + nav link |

---

## Task 1: Add `POST /api/live/upload` server endpoint

**Files:**
- Modify: `server/src/routes/upload.js`

- [ ] **Step 1: Add the route after the existing `/upload-ref` route**

Open `server/src/routes/upload.js`. After the `router.post('/upload-ref', ...)` block (around line 66), add:

```js
router.post('/live/upload', uploadRef.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded' });
  }
  const relativePath = GPT_SOVITS_ROOT ? path.relative(GPT_SOVITS_ROOT, req.file.path) : '';
  const pathForClient = relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(req.file.path);
  res.json({ filePath: pathForClient.replace(/\\/g, '/') });
});
```

This reuses the existing `uploadRef` multer instance (which saves to `REF_AUDIO_DIR`) with a different field name (`audio` instead of `file`). The response format matches what `/api/transcribe` expects as input.

- [ ] **Step 2: Start the server and verify the endpoint accepts a file**

```bash
cd server && npm run dev
```

In a second terminal, test with curl (substitute a real `.wav` path):
```bash
curl -X POST http://localhost:3000/api/live/upload \
  -F "audio=@C:/path/to/any/short.wav" \
  -s | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(d)"
```

Expected: `{"filePath":"TEMP/ref_audio/ref_<timestamp>_short.wav"}` (path format may vary)

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/upload.js
git commit -m "feat: add POST /api/live/upload endpoint for live recording"
```

---

## Task 2: Add `removedLiveAudioUpload` API helper

**Files:**
- Modify: `client/src/services/api.js`

- [ ] **Step 1: Add the export after `uploadRefAudio`**

Open `client/src/services/api.js`. After the `uploadRefAudio` export (around line 72), add:

```js
export async function removedLiveAudioUpload(blob) {
  const ext = blob.type.includes('ogg') ? '.ogg' : blob.type.includes('mp4') ? '.mp4' : '.webm';
  const formData = new FormData();
  formData.append('audio', blob, `live-recording${ext}`);
  return api.post('/live/upload', formData);
}
```

- [ ] **Step 2: Verify no import errors**

```bash
cd client && npm run dev
```

Expected: Vite dev server starts without errors. No browser console errors on any page.

- [ ] **Step 3: Commit**

```bash
git add client/src/services/api.js
git commit -m "feat: add removedLiveAudioUpload API helper"
```

---

## Task 3: Create `LivePage.jsx`

**Files:**
- Create: `client/src/pages/LivePage.jsx`

- [ ] **Step 1: Create the file with this complete content**

```jsx
import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useInferenceSSE } from '../hooks/useInferenceSSE.js';
import {
  getInferenceStatus,
  getCurrentInference,
  removedLiveAudioUpload,
  transcribeAudio,
  startGeneration,
  getGenerationResult,
} from '../services/api.js';
import { Badge } from '@/components/ui/badge';
import { Activity, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';

const INFERENCE_DRAFT_KEY = 'voice-cloning-inference-draft';

export default function LivePage() {
  const [phase, setPhase] = useState('idle'); // idle | recording | processing | playing
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState(null);
  const [serverReady, setServerReady] = useState(false);
  const [loadedVoiceName, setLoadedVoiceName] = useState('');
  const [refParams, setRefParams] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const sessionIdRef = useRef(null);
  const audioRef = useRef(null);
  const streamRef = useRef(null);

  const inference = useInferenceSSE();

  useEffect(() => {
    async function init() {
      try {
        const statusRes = await getInferenceStatus();
        setServerReady(Boolean(statusRes.data.ready));
        const loaded = statusRes.data.loaded;
        if (loaded?.sovitsPath) {
          const name = loaded.sovitsPath.replace(/\\/g, '/').split('/').pop()?.replace(/\.pth$/i, '') || '';
          setLoadedVoiceName(name);
        }
      } catch {
        setServerReady(false);
      }

      try {
        const currentRes = await getCurrentInference();
        const params = currentRes.data?.params;
        if (params?.ref_audio_path) {
          setRefParams({
            ref_audio_path: params.ref_audio_path,
            prompt_text: params.prompt_text || '',
            prompt_lang: params.prompt_lang || 'en',
          });
          return;
        }
      } catch { /* fall through */ }

      try {
        const raw = window.localStorage.getItem(INFERENCE_DRAFT_KEY);
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft.refAudioPath) {
            setRefParams({
              ref_audio_path: draft.refAudioPath,
              prompt_text: draft.promptText || '',
              prompt_lang: draft.promptLang || 'en',
            });
          }
        }
      } catch { /* ignore */ }
    }
    init();
  }, []);

  useEffect(() => {
    if (inference.status === 'complete' && sessionIdRef.current) {
      getGenerationResult(sessionIdRef.current)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          setAudioUrl(url);
          setPhase('playing');
        })
        .catch((err) => {
          setError(err.message);
          setPhase('idle');
        });
    }
    if (inference.status === 'error' || inference.status === 'cancelled') {
      setError(inference.error || 'Generation failed');
      setPhase('idle');
    }
  }, [inference.status, inference.error]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audioUrl || !audio) return;
    audio.src = audioUrl;
    audio.play().catch(() => {});
    const handleEnded = () => {
      setPhase('idle');
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    };
    audio.addEventListener('ended', handleEnded, { once: true });
  }, [audioUrl]);

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      inference.disconnect();
    };
  }, []);

  async function startRecording() {
    if (phase !== 'idle') return;
    setError(null);
    setTranscript('');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access denied. Please allow microphone access and try again.');
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : '';

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      chunksRef.current = [];
      await runPipeline(blob);
    };

    recorder.start();
    setPhase('recording');
  }

  function stopRecording() {
    if (phase !== 'recording' || !mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    setPhase('processing');
  }

  async function runPipeline(blob) {
    try {
      const uploadRes = await removedLiveAudioUpload(blob);
      const { filePath } = uploadRes.data;

      const transcribeRes = await transcribeAudio(filePath, 'auto');
      const { text, language } = transcribeRes.data;
      setTranscript(text || '');

      if (!text?.trim()) {
        setError('No speech detected. Try speaking louder or closer to the mic.');
        setPhase('idle');
        return;
      }

      const genRes = await startGeneration({
        text,
        text_lang: language || 'en',
        ref_audio_path: refParams.ref_audio_path,
        prompt_text: refParams.prompt_text,
        prompt_lang: refParams.prompt_lang,
      });
      const { sessionId } = genRes.data;
      sessionIdRef.current = sessionId;
      inference.connect(sessionId, { initialStatus: 'waiting' });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Pipeline failed');
      setPhase('idle');
    }
  }

  const isReady = serverReady && Boolean(refParams);

  const phaseLabel = {
    idle: 'Hold to speak',
    recording: 'Recording…',
    processing: 'Processing…',
    playing: 'Playing…',
  }[phase];

  return (
    <div className="animate-fade-in space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[32px] border border-sky-200/50 bg-[linear-gradient(135deg,#0f172a_0%,#082f49_42%,#115e59_100%)] px-6 py-7 text-white shadow-[0_32px_90px_-45px_rgba(15,23,42,0.85)] sm:px-8 lg:px-10">
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.35),transparent_55%)]" />
        <div className="absolute -left-16 top-8 h-40 w-40 rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="relative">
          <Badge className="border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-white shadow-none">
            Live Studio
          </Badge>
          <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Speak in real time with a cloned voice.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72 sm:text-base">
            Hold the button, say something, and hear it back as the loaded voice.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Badge className="border border-white/12 bg-white/10 px-3 py-1.5 text-white shadow-none">
              <Activity size={12} className="mr-1.5" />
              {serverReady ? `Voice: ${loadedVoiceName || 'Loaded'}` : 'No voice loaded'}
            </Badge>
            {refParams && (
              <Badge className="border border-white/12 bg-white/10 px-3 py-1.5 text-white shadow-none">
                Ref: {refParams.ref_audio_path.replace(/\\/g, '/').split('/').pop()}
              </Badge>
            )}
          </div>
        </div>
      </section>

      {/* Not-ready warning */}
      {!isReady && (
        <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          {!serverReady ? (
            <>No voice model is loaded.{' '}
              <Link to="/inference" className="font-semibold underline">Go to Inference</Link>
              {' '}to load one first.
            </>
          ) : (
            <>No reference audio found.{' '}
              <Link to="/inference" className="font-semibold underline">Go to Inference</Link>
              {' '}and generate at least once to set a reference.
            </>
          )}
        </div>
      )}

      {/* PTT + output */}
      <div className="flex flex-col items-center gap-8">
        <button
          className={cn(
            'flex h-36 w-36 select-none flex-col items-center justify-center gap-2 rounded-full border-4 text-sm font-semibold transition-all',
            !isReady || phase === 'processing' || phase === 'playing'
              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
              : phase === 'recording'
              ? 'border-red-400 bg-red-50 text-red-600 shadow-[0_0_0_8px_rgba(239,68,68,0.15)]'
              : 'cursor-pointer border-sky-300 bg-sky-50 text-sky-700 shadow-[0_18px_50px_-20px_rgba(14,165,233,0.5)] hover:shadow-[0_18px_50px_-20px_rgba(14,165,233,0.7)] active:scale-95'
          )}
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onMouseLeave={() => { if (phase === 'recording') stopRecording(); }}
          onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
          onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
          disabled={!isReady || phase === 'processing' || phase === 'playing'}
        >
          <Mic size={32} />
          <span>{phaseLabel}</span>
        </button>

        {transcript && (
          <div className="w-full max-w-lg rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Transcript</p>
            <p className="text-sm leading-7 text-foreground">{transcript}</p>
          </div>
        )}

        {error && (
          <div className="w-full max-w-lg rounded-[22px] border border-destructive/20 bg-destructive/5 px-5 py-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <audio ref={audioRef} controls className={cn('w-full max-w-lg', !audioUrl && 'hidden')} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify no import or syntax errors**

With `cd client && npm run dev` already running, open the browser at `http://localhost:5173`. No console errors should appear when navigating (the page isn't wired to a route yet — that's Task 4).

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/LivePage.jsx
git commit -m "feat: add LivePage component for push-to-talk voice inference"
```

---

## Task 4: Wire `/live` route and nav link into `App.jsx`

**Files:**
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Add the import and route**

In `client/src/App.jsx`, add the import after the `InferencePage` import (line 8):

```js
import LivePage from './pages/LivePage.jsx';
```

Add the route inside `<Routes>` after the `/inference` route (around line 91):

```jsx
<Route path="/live" element={<LivePage />} />
```

- [ ] **Step 2: Add the nav link**

After the closing `</NavLink>` for Inference (around line 82), add a third NavLink following the same pattern:

```jsx
<NavLink
  to="/live"
  className={({ isActive }) =>
    cn(
      "group relative inline-flex h-11 items-center text-sm font-medium transition-colors",
      isActive
        ? "text-foreground"
        : "text-muted-foreground hover:text-foreground"
    )
  }
>
  {({ isActive }) => (
    <>
      <span>Live</span>
      <span
        className={cn(
          "absolute inset-x-0 bottom-0 h-0.5 rounded-full transition-colors",
          isActive ? "bg-primary" : "bg-transparent group-hover:bg-slate-200"
        )}
      />
    </>
  )}
</NavLink>
```

- [ ] **Step 3: Verify the route works**

Navigate to `http://localhost:5173/live`. Expected:
- "Live" tab appears in the header nav, highlighted when active
- Hero banner renders with "Live Studio" badge
- If no model is loaded: amber warning appears with link to `/inference`
- If a model is loaded and a prior inference exists: button shows "Hold to speak" and is interactive

- [ ] **Step 4: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat: add /live route and nav link"
```

---

## Task 5: End-to-end verification

- [ ] **Step 1: Set up prerequisites**

1. Start the server: `cd server && npm run dev`
2. Start the client: `cd client && npm run dev`
3. Open `http://localhost:5173/inference`
4. Load a voice profile (Step 1 on the Inference page)
5. Select a reference audio and confirm it (Step 2)
6. Generate at least one inference (Step 5) — this populates server session state

- [ ] **Step 2: Open the Live page and check status**

Navigate to `http://localhost:5173/live`.

Expected:
- Hero shows loaded voice name in the "Voice: …" badge
- Hero shows reference filename in the "Ref: …" badge
- No amber warning visible
- Button shows "Hold to speak" in sky blue styling

- [ ] **Step 3: Test a successful push-to-talk round-trip**

1. Click and hold the button — it should turn red and show "Recording…"
2. Say a short sentence clearly (2–5 words)
3. Release — button shows "Processing…"
4. Wait 5–15 seconds (transcription + inference)
5. Button shows "Playing…" and the audio plays automatically
6. The transcript panel appears below the button showing your words
7. After playback ends, button returns to "Hold to speak"

- [ ] **Step 4: Test error recovery**

1. While no inference is generating, open DevTools → Network → set to "Offline"
2. Hold the button, say something, release
3. Expected: error message appears below the button ("Pipeline failed" or similar)
4. Set network back to "Online"
5. Hold button again — error clears, new recording starts

- [ ] **Step 5: Test with no model loaded (server restart scenario)**

1. Stop the server (`Ctrl+C`)
2. Restart: `cd server && npm run dev` (model is no longer loaded after restart)
3. Navigate to `http://localhost:5173/live`
4. Expected: amber warning "No voice model is loaded" with link to Inference page
5. Button is disabled (cursor-not-allowed, grey styling)

- [ ] **Step 6: Final commit if any fixes were made during verification**

```bash
git add -p
git commit -m "fix: <describe what was fixed during verification>"
```

If no fixes were needed, skip this step.
