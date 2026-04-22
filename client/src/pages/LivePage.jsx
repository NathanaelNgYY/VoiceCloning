import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getInferenceStatus, getCurrentInference } from '../services/api.js';
import { useLiveSpeech } from '../hooks/useLiveSpeech.js';
import { Badge } from '@/components/ui/badge';
import { Activity, Download, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    if (!audio) return;
    if (!liveSpeech.audioSrc) {
      audio.src = '';
      return;
    }
    audio.src = liveSpeech.audioSrc;
    audio.play().catch(() => {});
  }, [liveSpeech.audioSrc]);

  const isReady = serverReady && Boolean(refParams);

  const buttonDisabled =
    !isReady || liveSpeech.phase === 'processing' || liveSpeech.phase === 'done';

  const phaseLabel = {
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

        <div className={cn('w-full max-w-lg space-y-3', !liveSpeech.audioSrc && 'hidden')}>
          <div className="rounded-[24px] border border-emerald-100 bg-[linear-gradient(135deg,rgba(236,253,245,0.95),rgba(239,246,255,0.9))] p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-sm font-medium text-foreground">Generated Audio</span>
            </div>
            <audio
              ref={audioRef}
              controls
              className="w-full"
              onEnded={liveSpeech.onAudioEnded}
            />
            <div className="mt-3">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl border-slate-200 bg-white/85"
                asChild
              >
                <a href={liveSpeech.audioSrc || '#'} download="live_voice.wav">
                  <Download size={14} />
                  Download WAV
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
