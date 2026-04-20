import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useInferenceSSE } from '../hooks/useInferenceSSE.js';
import {
  getInferenceStatus,
  getCurrentInference,
  uploadLiveAudio,
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
  const audioUrlRef = useRef(null);

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
          audioUrlRef.current = url;
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
      audioUrlRef.current = null;
    };
    audio.addEventListener('ended', handleEnded, { once: true });
  }, [audioUrl]);

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
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
      if (!refParams) {
        setError('Reference audio is no longer available. Please reconfigure on the Inference page.');
        setPhase('idle');
        return;
      }
      const uploadRes = await uploadLiveAudio(blob);
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
