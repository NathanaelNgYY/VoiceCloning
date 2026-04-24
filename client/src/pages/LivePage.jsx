import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCurrentInference, getInferenceStatus } from '../services/api.js';
import { useLiveSpeech } from '../hooks/useLiveSpeech.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { MicLevelMeter } from '@/components/MicLevelMeter';
import { Activity, CircleAlert, Download, Loader2, Mic, PlayCircle } from 'lucide-react';

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
      } catch {
        // Fall through to localStorage.
      }

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
      } catch {
        // Ignore stale local draft data.
      }
    }
    init();
  }, []);

  const liveSpeech = useLiveSpeech({ refParams });
  const playbackReady = liveSpeech.shouldPlayAudio && Boolean(liveSpeech.audioSrc);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!playbackReady) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      return;
    }

    if (audio.getAttribute('src') !== liveSpeech.audioSrc) {
      audio.src = liveSpeech.audioSrc;
      audio.load();
    }
    audio.play().catch(() => {});
  }, [liveSpeech.audioSrc, liveSpeech.selectedClipId, playbackReady]);

  const isReady = serverReady && Boolean(refParams);
  const isListening = liveSpeech.phase === 'listening' || liveSpeech.phase === 'thinking';
  const buttonDisabled =
    !isReady || liveSpeech.phase === 'connecting' || liveSpeech.phase === 'stopping';
  const phaseLabel =
    {
      idle: 'Start conversation',
      connecting: 'Connecting...',
      listening: 'Stop conversation',
      thinking: 'Stop conversation',
      speaking: 'Interrupt',
      stopping: 'Stopping...',
    }[liveSpeech.phase] || 'Start conversation';
  const statusText =
    liveSpeech.notice ||
    {
      idle: 'Ready to start a live voice conversation.',
      connecting: 'Connecting to the live assistant...',
      listening: 'Listening...',
      thinking: 'Thinking...',
      speaking: 'Playing the cloned voice reply...',
      stopping: 'Stopping conversation...',
    }[liveSpeech.phase] ||
    'Ready to start a live voice conversation.';

  const displayTranscript = [liveSpeech.finalTranscript, liveSpeech.interimTranscript]
    .filter(Boolean)
    .join(' ');
  const isInterim = Boolean(liveSpeech.interimTranscript);
  const hasClips = liveSpeech.audioClips.length > 0;
  const selectedClip = liveSpeech.selectedClip;

  return (
    <div className="animate-fade-in space-y-8">
      <section className="relative overflow-hidden rounded-[32px] border border-sky-200/50 bg-[linear-gradient(135deg,#0f172a_0%,#082f49_42%,#115e59_100%)] px-6 py-7 text-white shadow-[0_32px_90px_-45px_rgba(15,23,42,0.85)] sm:px-8 lg:px-10">
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.35),transparent_55%)]" />
        <div className="absolute -left-16 top-8 h-40 w-40 rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="relative">
          <Badge className="border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-white shadow-none">
            Live Studio
          </Badge>
          <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Chat live through a cloned voice.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72 sm:text-base">
            Talk with the assistant and hear replies spoken back using the selected cloned voice.
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

      <div className="flex flex-col items-center gap-8">
        <button
          type="button"
          className={cn(
            'flex h-36 w-36 select-none flex-col items-center justify-center gap-2 rounded-full border-4 text-sm font-semibold transition-all',
            buttonDisabled
              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
              : liveSpeech.phase === 'speaking'
                ? 'cursor-pointer border-amber-400 bg-amber-50 text-amber-700 shadow-[0_0_0_8px_rgba(245,158,11,0.15)] active:scale-95'
                : isListening
                ? 'border-red-400 bg-red-50 text-red-600 shadow-[0_0_0_8px_rgba(239,68,68,0.15)]'
                : 'cursor-pointer border-sky-300 bg-sky-50 text-sky-700 shadow-[0_18px_50px_-20px_rgba(14,165,233,0.5)] hover:shadow-[0_18px_50px_-20px_rgba(14,165,233,0.7)] active:scale-95'
          )}
          onClick={liveSpeech.toggle}
          disabled={buttonDisabled}
          aria-pressed={liveSpeech.phase !== 'idle'}
        >
          <Mic size={32} />
          <span>{phaseLabel}</span>
        </button>

        <MicLevelMeter level={liveSpeech.audioLevel} active={isListening} />

        <div className="w-full max-w-lg rounded-[22px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-sm font-medium text-foreground">The AI listens while you speak.</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            When the cloned voice is playing, listening pauses. Speak again or tap the mic to
            interrupt.
          </p>
        </div>

        <div className="w-full max-w-lg rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-4">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Status
          </p>
          <p className="text-sm leading-6 text-foreground">{statusText}</p>
          {displayTranscript && (
            <p
              className={cn(
                'mt-3 border-t border-slate-200 pt-3 text-sm leading-7',
                isInterim ? 'text-muted-foreground italic' : 'text-foreground'
              )}
            >
              {displayTranscript}
            </p>
          )}
        </div>

        {liveSpeech.error && (
          <div className="w-full max-w-lg rounded-[22px] border border-destructive/20 bg-destructive/5 px-5 py-4 text-sm text-destructive">
            {liveSpeech.error}
          </div>
        )}

        {hasClips && (
          <div className="w-full max-w-xl rounded-[24px] border border-emerald-100 bg-[linear-gradient(135deg,rgba(236,253,245,0.95),rgba(239,246,255,0.9))] p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium text-foreground">Conversation Replies</span>
              </div>
              <Badge className="border border-emerald-200 bg-white/70 text-emerald-700 shadow-none">
                {liveSpeech.audioClips.length} total
              </Badge>
            </div>

            <Select value={liveSpeech.selectedClipId} onValueChange={liveSpeech.selectClip}>
              <SelectTrigger className="bg-white/85">
                <SelectValue placeholder="Select a ready reply" />
              </SelectTrigger>
              <SelectContent>
                {liveSpeech.audioClips.map((clip) => (
                  <SelectItem key={clip.id} value={clip.id} disabled={clip.status !== 'ready'}>
                    {`Reply ${clip.index}: ${clip.text.slice(0, 70)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedClip?.text && (
              <p className="mt-3 rounded-2xl border border-white/80 bg-white/70 px-4 py-3 text-sm leading-6 text-slate-700">
                {selectedClip.text}
              </p>
            )}

            <audio
              ref={audioRef}
              controls
              className={cn('mt-4 w-full', !playbackReady && 'hidden')}
              onEnded={liveSpeech.onAudioEnded}
            />

            <div className="mt-4 max-h-56 overflow-y-auto rounded-2xl border border-emerald-100 bg-white/55">
              {liveSpeech.audioClips.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-3 border-b border-emerald-100 px-4 py-3 text-left last:border-b-0',
                    clip.status === 'ready'
                      ? 'text-slate-700 hover:bg-white/75'
                      : 'cursor-default text-slate-500',
                    liveSpeech.selectedClipId === clip.id && 'bg-white/90'
                  )}
                  onClick={() => liveSpeech.selectClip(clip.id)}
                  disabled={clip.status !== 'ready'}
                >
                  {clip.status === 'generating' ? (
                    <Loader2 size={16} className="shrink-0 animate-spin text-sky-500" />
                  ) : clip.status === 'error' ? (
                    <CircleAlert size={16} className="shrink-0 text-destructive" />
                  ) : (
                    <PlayCircle size={16} className="shrink-0 text-emerald-600" />
                  )}
                  <span className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Reply {clip.index}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{clip.text}</span>
                  <span className="shrink-0 text-xs capitalize text-slate-500">
                    {clip.status}
                  </span>
                </button>
              ))}
            </div>

            {playbackReady && (
              <div className="mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl border-slate-200 bg-white/85"
                  asChild
                >
                  <a href={liveSpeech.audioSrc} download={`live_reply_${selectedClip?.index || 1}.wav`}>
                    <Download size={14} />
                    Download WAV
                  </a>
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
