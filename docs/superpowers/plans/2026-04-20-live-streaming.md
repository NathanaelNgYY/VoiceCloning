# Live Page Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Live page's single-batch pipeline with two parallel tracks: Web Speech API synthesis-per-sentence while speaking (Track A) and Whisper + per-chunk streaming playback as fallback (Track B).

**Architecture:** While the user holds the mic button, `SpeechRecognition` fires final sentence results which are serialised through a new `POST /live/tts-sentence` endpoint returning WAV blobs directly. A shared audio queue plays them in order. After release, Whisper transcribes for display; if Track A produced nothing, `synthesizeLongTextStreaming` runs and each chunk is fetched via `GET /inference/chunk/:sessionId/:index` and played as it arrives.

**Tech Stack:** React 18 hooks, MediaRecorder API, Web Speech API (`SpeechRecognition`), Express, existing `inferenceServer.synthesize()`, existing SSE pipeline.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server/src/services/longTextInference.js` | Modify | Export `getSessionChunkPath` helper |
| `server/src/routes/inference.js` | Modify | Add `POST /live/tts-sentence` and `GET /inference/chunk/:sessionId/:index` |
| `client/src/services/api.js` | Modify | Add `synthesizeSentence()` and `getInferenceChunk()` helpers |
| `client/src/hooks/useLiveSpeech.js` | Create | All Live page logic: recording, speech recognition, synthesis queue, audio queue |
| `client/src/pages/LivePage.jsx` | Modify | Swap manual pipeline for `useLiveSpeech`; add interim transcript UI |

---

## Task 1: Export `getSessionChunkPath` from `longTextInference.js`

**Files:**
- Modify: `server/src/services/longTextInference.js`

- [ ] **Step 1: Add the export after the existing `getSessionFinalPath` export (line ~973)**

In `server/src/services/longTextInference.js`, after the `getSessionFinalPath` function, add:

```js
export function getSessionChunkPath(sessionId, index) {
  return path.join(getSessionDir(sessionId), `chunk_${String(index).padStart(3, '0')}.wav`);
}
```

- [ ] **Step 2: Restart the server and confirm no crash**

```bash
cd server && npm run dev
```

Expected: Server starts on port 3000 with no import errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/longTextInference.js
git commit -m "feat: export getSessionChunkPath from longTextInference"
```

---

## Task 2: Add `POST /live/tts-sentence` endpoint

**Files:**
- Modify: `server/src/routes/inference.js`

The endpoint calls `inferenceServer.synthesize()` directly (no SSE, no session) and returns the WAV buffer. The client serialises calls so the inference server is never double-booked.

- [ ] **Step 1: Add the import for `getSessionChunkPath` at the top of `inference.js`**

The current import from `longTextInference.js` on line ~19 is:
```js
import { synthesizeLongText, synthesizeLongTextStreaming, cancelSession, getSessionFinalPath } from '../services/longTextInference.js';
```

Change it to:
```js
import { synthesizeLongText, synthesizeLongTextStreaming, cancelSession, getSessionFinalPath, getSessionChunkPath } from '../services/longTextInference.js';
```

- [ ] **Step 2: Add the route at the end of `inference.js` (before `export default router`)**

```js
router.post('/live/tts-sentence', async (req, res) => {
  const configError = getInferenceConfigError();
  if (configError) {
    return res.status(500).json({ error: configError });
  }

  const {
    text,
    text_lang = 'en',
    ref_audio_path,
    prompt_text = '',
    prompt_lang = 'en',
    aux_ref_audio_paths = [],
    top_k = 5,
    top_p = 0.85,
    temperature = 0.7,
    repetition_penalty = 1.35,
    speed_factor = 1.0,
    seed = -1,
  } = req.body;

  if (!text?.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (!ref_audio_path) {
    return res.status(400).json({ error: 'ref_audio_path is required' });
  }

  if (!await inferenceServer.checkReady()) {
    return res.status(503).json({ error: 'Inference server is not running. Load models first.' });
  }

  try {
    const resolved = await resolveRefAudioPaths(ref_audio_path, aux_ref_audio_paths);
    const audioBuffer = await inferenceServer.synthesize({
      text: `${text.trim()} `,
      text_lang,
      ref_audio_path: resolved.refPath,
      prompt_text,
      prompt_lang,
      aux_ref_audio_paths: resolved.auxPaths,
      top_k,
      top_p,
      temperature,
      repetition_penalty,
      speed_factor,
      seed,
      text_split_method: 'cut0',
      batch_size: 1,
      streaming_mode: false,
      split_bucket: true,
      parallel_infer: false,
      fragment_interval: 0.1,
    });
    res.set({ 'Content-Type': 'audio/wav', 'Content-Length': audioBuffer.length });
    res.send(audioBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Restart the server and smoke-test with curl**

With a loaded model, run (replacing paths with real values):

```bash
curl -s -X POST http://localhost:3000/api/live/tts-sentence \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello world.","ref_audio_path":"<ref_path>","prompt_text":"<prompt>","prompt_lang":"en","text_lang":"en"}' \
  --output /tmp/test.wav && echo "OK: $(wc -c < /tmp/test.wav) bytes"
```

Expected: `OK: <some large number> bytes` (a valid WAV file).

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/inference.js
git commit -m "feat: add POST /live/tts-sentence endpoint for per-sentence synthesis"
```

---

## Task 3: Add `GET /inference/chunk/:sessionId/:index` endpoint

**Files:**
- Modify: `server/src/routes/inference.js`

Serves an individual chunk WAV written by `synthesizeLongTextStreaming`. Validates both path params to prevent path traversal.

- [ ] **Step 1: Add the route in `inference.js` after the `GET /inference/result/:sessionId` handler (~line 324)**

```js
router.get('/inference/chunk/:sessionId/:index', (req, res) => {
  const { sessionId, index } = req.params;

  if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' });
  }
  const chunkIndex = parseInt(index, 10);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 999) {
    return res.status(400).json({ error: 'Invalid chunk index' });
  }

  const chunkPath = getSessionChunkPath(sessionId, chunkIndex);

  if (!fs.existsSync(chunkPath)) {
    return res.status(404).json({ error: 'Chunk not found' });
  }

  const stat = fs.statSync(chunkPath);
  res.set({ 'Content-Type': 'audio/wav', 'Content-Length': stat.size });
  fs.createReadStream(chunkPath).pipe(res);
});
```

- [ ] **Step 2: Restart the server and test**

Start a generation on the Inference page (any text with 2+ sentences). While it runs, pick up the `sessionId` from the browser Network tab. Then:

```bash
curl -s "http://localhost:3000/api/inference/chunk/<sessionId>/0" --output /tmp/chunk0.wav && echo "OK: $(wc -c < /tmp/chunk0.wav) bytes"
```

Expected: `OK: <large number> bytes`.

Test invalid inputs return errors:

```bash
curl -s "http://localhost:3000/api/inference/chunk/../etc/passwd/0"
# Expected: {"error":"Invalid sessionId"}

curl -s "http://localhost:3000/api/inference/chunk/valid-id/abc"
# Expected: {"error":"Invalid chunk index"}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/inference.js
git commit -m "feat: add GET /inference/chunk/:sessionId/:index endpoint"
```

---

## Task 4: Add API helpers to `client/src/services/api.js`

**Files:**
- Modify: `client/src/services/api.js`

- [ ] **Step 1: Add `synthesizeSentence` after the existing `synthesize` function (~line 137)**

```js
export async function synthesizeSentence(params) {
  const res = await api.post('/live/tts-sentence', params, {
    responseType: 'blob',
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    const text = await res.data.text();
    let message;
    try {
      message = JSON.parse(text).error;
    } catch {
      message = text;
    }
    throw new Error(message || `Request failed with status ${res.status}`);
  }

  return new Blob([res.data], { type: 'audio/wav' });
}
```

- [ ] **Step 2: Add `getInferenceChunk` after `getGenerationResult` (~line 160)**

```js
export async function getInferenceChunk(sessionId, index) {
  const res = await api.get(`/inference/chunk/${sessionId}/${index}`, {
    responseType: 'blob',
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    throw new Error(`Chunk not available (${res.status})`);
  }
  return new Blob([res.data], { type: 'audio/wav' });
}
```

- [ ] **Step 3: Restart dev server and confirm no import errors**

```bash
cd client && npm run dev
```

Expected: Vite starts on port 5173 with no module errors in the terminal.

- [ ] **Step 4: Commit**

```bash
git add client/src/services/api.js
git commit -m "feat: add synthesizeSentence and getInferenceChunk API helpers"
```

---

## Task 5: Create `useLiveSpeech` hook

**Files:**
- Create: `client/src/hooks/useLiveSpeech.js`

This hook owns everything: MediaRecorder, SpeechRecognition, synthesis text queue, audio object-URL queue. LivePage just calls `start()` / `stop()` and reads `audioSrc`.

- [ ] **Step 1: Create `client/src/hooks/useLiveSpeech.js`**

```js
import { useState, useEffect, useRef } from 'react';
import { connectInferenceSSE } from '../services/sse.js';
import {
  uploadLiveAudio,
  transcribeAudio,
  startGeneration,
  synthesizeSentence,
  getInferenceChunk,
} from '../services/api.js';

export function useLiveSpeech({ refParams }) {
  const [phase, setPhaseState] = useState('idle'); // idle | recording | processing | done
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [audioSrc, setAudioSrc] = useState(null);
  const [error, setError] = useState(null);
  const [speechApiAvailable, setSpeechApiAvailable] = useState(
    typeof window !== 'undefined' &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  );

  const phaseRef = useRef('idle');
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);
  const pendingTextRef = useRef([]);
  const audioQueueRef = useRef([]);
  const isSynthesisingRef = useRef(false);
  const isCancelledRef = useRef(false);
  const currentUrlRef = useRef(null);
  const allUrlsRef = useRef([]);
  const esRef = useRef(null);

  function setPhase(p) {
    phaseRef.current = p;
    setPhaseState(p);
  }

  function advanceAudioQueue() {
    if (audioQueueRef.current.length === 0) {
      currentUrlRef.current = null;
      setAudioSrc(null);
      if (phaseRef.current === 'done' || phaseRef.current === 'processing') {
        setPhase('idle');
      }
      return;
    }
    const url = audioQueueRef.current.shift();
    currentUrlRef.current = url;
    setAudioSrc(url);
  }

  function pushAudioUrl(url) {
    allUrlsRef.current.push(url);
    audioQueueRef.current.push(url);
    if (!currentUrlRef.current) {
      advanceAudioQueue();
    }
  }

  async function drainTextQueue() {
    if (isSynthesisingRef.current) return;
    if (pendingTextRef.current.length === 0) return;
    if (!refParams) return;

    isSynthesisingRef.current = true;
    while (pendingTextRef.current.length > 0 && !isCancelledRef.current) {
      const text = pendingTextRef.current.shift();
      try {
        const blob = await synthesizeSentence({
          text,
          text_lang: refParams.prompt_lang || 'en',
          ref_audio_path: refParams.ref_audio_path,
          prompt_text: refParams.prompt_text,
          prompt_lang: refParams.prompt_lang || 'en',
        });
        if (isCancelledRef.current) break;
        pushAudioUrl(URL.createObjectURL(blob));
      } catch (err) {
        if (!isCancelledRef.current) {
          setError(`Sentence synthesis failed: ${err.message}`);
        }
      }
    }
    isSynthesisingRef.current = false;
  }

  function waitForTextDrain() {
    return new Promise((resolve) => {
      const check = () => {
        if (pendingTextRef.current.length === 0 && !isSynthesisingRef.current) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  async function runFallbackStreaming(text, language) {
    try {
      const genRes = await startGeneration({
        text,
        text_lang: language || 'en',
        ref_audio_path: refParams.ref_audio_path,
        prompt_text: refParams.prompt_text,
        prompt_lang: refParams.prompt_lang || 'en',
      });
      const { sessionId } = genRes.data;

      esRef.current = connectInferenceSSE(sessionId, {
        onChunkComplete(data) {
          if (isCancelledRef.current) return;
          getInferenceChunk(sessionId, data.index)
            .then((blob) => {
              if (!isCancelledRef.current) pushAudioUrl(URL.createObjectURL(blob));
            })
            .catch((err) => {
              if (!isCancelledRef.current) {
                setError(`Failed to load audio chunk: ${err.message}`);
              }
            });
        },
        onComplete() {
          if (!isCancelledRef.current) setPhase('done');
        },
        onError(data) {
          if (!isCancelledRef.current) {
            setError(data?.message || 'Generation failed');
            setPhase('idle');
          }
        },
      });
    } catch (err) {
      if (!isCancelledRef.current) {
        setError(err.response?.data?.error || err.message || 'Generation failed');
        setPhase('idle');
      }
    }
  }

  async function runPostReleasePipeline(blob) {
    try {
      const uploadRes = await uploadLiveAudio(blob);
      const { filePath } = uploadRes.data;

      const transcribeRes = await transcribeAudio(filePath, 'auto');
      const { text, language } = transcribeRes.data;
      if (!isCancelledRef.current) setFinalTranscript(text || '');

      // Wait for any Track A synthesis to finish before deciding
      await waitForTextDrain();
      if (isCancelledRef.current) return;

      const trackAProducedAudio = allUrlsRef.current.length > 0;
      if (trackAProducedAudio) {
        setPhase('done');
        return;
      }

      if (!text?.trim()) {
        setError('No speech detected. Try speaking louder or closer to the mic.');
        setPhase('idle');
        return;
      }

      await runFallbackStreaming(text, language);
    } catch (err) {
      if (!isCancelledRef.current) {
        setError(err.response?.data?.error || err.message || 'Pipeline failed');
        setPhase('idle');
      }
    }
  }

  async function start() {
    if (phaseRef.current !== 'idle') return;
    if (!refParams) {
      setError('No reference audio configured. Go to the Inference page first.');
      return;
    }

    isCancelledRef.current = false;
    pendingTextRef.current = [];
    audioQueueRef.current = [];
    allUrlsRef.current = [];
    isSynthesisingRef.current = false;
    currentUrlRef.current = null;

    setError(null);
    setInterimTranscript('');
    setFinalTranscript('');
    setAudioSrc(null);

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access denied. Please allow microphone access and try again.');
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechApiAvailable(true);
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              const sentence = result[0].transcript.trim();
              if (sentence) {
                pendingTextRef.current.push(sentence);
                drainTextQueue();
              }
            } else {
              interim += result[0].transcript;
            }
          }
          setInterimTranscript(interim);
        };

        recognition.onerror = (event) => {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setSpeechApiAvailable(false);
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      } catch {
        setSpeechApiAvailable(false);
      }
    } else {
      setSpeechApiAvailable(false);
    }

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
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const audioBlob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      chunksRef.current = [];
      await runPostReleasePipeline(audioBlob);
    };

    recorder.start();
    setPhase('recording');
  }

  function stop() {
    if (phaseRef.current !== 'recording') return;

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setInterimTranscript('');
    setPhase('processing');

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
  }

  function onAudioEnded() {
    advanceAudioQueue();
  }

  useEffect(() => {
    return () => {
      isCancelledRef.current = true;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (esRef.current) {
        esRef.current.close();
      }
      for (const url of allUrlsRef.current) {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      }
    };
  }, []);

  return {
    phase,
    interimTranscript,
    finalTranscript,
    audioSrc,
    error,
    speechApiAvailable,
    start,
    stop,
    onAudioEnded,
  };
}
```

- [ ] **Step 2: Verify the client builds without errors**

```bash
cd client && npm run dev
```

Expected: Vite compiles cleanly; no import errors in the terminal or browser console.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useLiveSpeech.js
git commit -m "feat: add useLiveSpeech hook with Web Speech API + audio queue"
```

---

## Task 6: Refactor `LivePage.jsx`

**Files:**
- Modify: `client/src/pages/LivePage.jsx`

Replace the manual MediaRecorder/runPipeline logic with `useLiveSpeech`. Keep the existing hero section and status badges. Add an interim transcript display.

- [ ] **Step 1: Replace the entire file content**

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getInferenceStatus, getCurrentInference } from '../services/api.js';
import { useLiveSpeech } from '../hooks/useLiveSpeech.js';
import { Badge } from '@/components/ui/badge';
import { Activity, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';

const INFERENCE_DRAFT_KEY = 'voice-cloning-inference-draft';

export default function LivePage() {
  const [serverReady, setServerReady] = useState(false);
  const [loadedVoiceName, setLoadedVoiceName] = useState('');
  const [refParams, setRefParams] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    async function init() {
      try {
        const statusRes = await getInferenceStatus();
        setServerReady(Boolean(statusRes.data.ready));
        const loaded = statusRes.data.loaded;
        if (loaded?.sovitsPath) {
          const name =
            loaded.sovitsPath.replace(/\\/g, '/').split('/').pop()?.replace(/\.pth$/i, '') || '';
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

  const liveSpeech = useLiveSpeech({ refParams });

  // Wire audio element to hook
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !liveSpeech.audioSrc) return;
    audio.src = liveSpeech.audioSrc;
    audio.play().catch(() => {});
  }, [liveSpeech.audioSrc]);

  const isReady = serverReady && Boolean(refParams);

  const buttonDisabled =
    !isReady || liveSpeech.phase === 'processing';

  const phaseLabel = liveSpeech.audioSrc
    ? 'Playing…'
    : {
        idle: 'Hold to speak',
        recording: 'Recording…',
        processing: 'Processing…',
        done: 'Playing…',
      }[liveSpeech.phase] || 'Hold to speak';

  const displayTranscript = liveSpeech.finalTranscript || liveSpeech.interimTranscript;
  const isInterim = !liveSpeech.finalTranscript && Boolean(liveSpeech.interimTranscript);

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
            <>
              No voice model is loaded.{' '}
              <Link to="/inference" className="font-semibold underline">
                Go to Inference
              </Link>{' '}
              to load one first.
            </>
          ) : (
            <>
              No reference audio found.{' '}
              <Link to="/inference" className="font-semibold underline">
                Go to Inference
              </Link>{' '}
              and generate at least once to set a reference.
            </>
          )}
        </div>
      )}

      {/* PTT + output */}
      <div className="flex flex-col items-center gap-8">
        <button
          className={cn(
            'flex h-36 w-36 select-none flex-col items-center justify-center gap-2 rounded-full border-4 text-sm font-semibold transition-all',
            buttonDisabled
              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
              : liveSpeech.phase === 'recording'
              ? 'border-red-400 bg-red-50 text-red-600 shadow-[0_0_0_8px_rgba(239,68,68,0.15)]'
              : 'cursor-pointer border-sky-300 bg-sky-50 text-sky-700 shadow-[0_18px_50px_-20px_rgba(14,165,233,0.5)] hover:shadow-[0_18px_50px_-20px_rgba(14,165,233,0.7)] active:scale-95'
          )}
          onMouseDown={liveSpeech.start}
          onMouseUp={liveSpeech.stop}
          onMouseLeave={() => {
            if (liveSpeech.phase === 'recording') liveSpeech.stop();
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            liveSpeech.start();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            liveSpeech.stop();
          }}
          disabled={buttonDisabled}
        >
          <Mic size={32} />
          <span>{phaseLabel}</span>
        </button>

        {displayTranscript && (
          <div className="w-full max-w-lg rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {isInterim ? 'Listening…' : 'Transcript'}
            </p>
            <p
              className={cn(
                'text-sm leading-7',
                isInterim ? 'text-muted-foreground italic' : 'text-foreground'
              )}
            >
              {displayTranscript}
            </p>
          </div>
        )}

        {liveSpeech.error && (
          <div className="w-full max-w-lg rounded-[22px] border border-destructive/20 bg-destructive/5 px-5 py-4 text-sm text-destructive">
            {liveSpeech.error}
          </div>
        )}

        <audio
          ref={audioRef}
          controls
          className={cn('w-full max-w-lg', !liveSpeech.audioSrc && 'hidden')}
          onEnded={liveSpeech.onAudioEnded}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Open the Live page in the browser and verify it loads**

Navigate to `http://localhost:5173/live`. Expected:
- Hero section renders
- "No voice loaded" warning shows if no model is loaded, or the mic button if one is

- [ ] **Step 3: Test Track A (Web Speech API path)**

Load a voice model and set a reference audio on the Inference page. Navigate to `/live`. Hold the button and say a sentence clearly. Expected:
- "Listening…" transcript shows while speaking (grey, italic)
- Audio plays before or shortly after you release the button
- After release, transcript upgrades to the Whisper version (non-italic)

- [ ] **Step 4: Test Track B fallback**

In Chrome DevTools console, before pressing the button, run:
```js
Object.defineProperty(window, 'SpeechRecognition', { get: () => undefined });
Object.defineProperty(window, 'webkitSpeechRecognition', { get: () => undefined });
```
Then hold button, speak, release. Expected:
- No "Listening…" during speech
- After release: "Processing…" shows, then audio plays chunk by chunk from the Whisper path

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/LivePage.jsx
git commit -m "feat: refactor LivePage to use useLiveSpeech with streaming playback"
```
