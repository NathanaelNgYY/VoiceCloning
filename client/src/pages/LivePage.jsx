import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSelectedVoiceId } from '../services/api.js';
import { useLiveSpeech } from '../hooks/useLiveSpeech.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MicLevelMeter } from '@/components/MicLevelMeter';
import {
  Activity,
  Bot,
  CircleAlert,
  Download,
  Loader2,
  Mic,
  PlayCircle,
  UserRound,
  Volume2,
} from 'lucide-react';

function messageStatusText(message) {
  if (message.role === 'user') {
    return {
      listening: 'Listening',
      transcribing: 'Transcribing',
      done: 'Sent',
    }[message.status] || 'Sent';
  }

  return {
    thinking: 'Writing',
    generating_voice: 'Generating cloned voice',
    ready: 'Voice ready',
    played: 'Played',
    interrupted: 'Interrupted',
    error: 'Failed',
  }[message.status] || 'Reply';
}

function ChatBubble({ message, selected, onPlay }) {
  const isUser = message.role === 'user';
  const readyParts = (message.audioParts || []).filter((part) => part.audioUrl);
  const hasVoice = !isUser && (Boolean(message.audioUrl) || readyParts.length > 0);
  const isBusy = ['thinking', 'generating_voice', 'transcribing', 'listening'].includes(message.status);

  return (
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
          <Bot size={16} />
        </div>
      )}

      <div
        className={cn(
          'max-w-[82%] rounded-2xl px-4 py-3 shadow-sm',
          isUser
            ? 'rounded-br-md bg-slate-900 text-white'
            : 'rounded-bl-md border border-slate-200 bg-white text-slate-900'
        )}
      >
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide opacity-70">
          {isBusy && <Loader2 size={12} className="animate-spin" />}
          {messageStatusText(message)}
        </div>

        <p className={cn('whitespace-pre-wrap text-sm leading-6', isBusy && !message.text && 'italic opacity-70')}>
          {message.text || (isUser ? 'Listening...' : 'Thinking...')}
        </p>

        {message.error && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
            <CircleAlert size={13} />
            {message.error}
          </p>
        )}

        {!isUser && message.audioParts?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.audioParts.map((part) => (
              <span
                key={part.id}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] capitalize',
                  part.status === 'ready' || part.status === 'played'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : part.status === 'generating'
                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                    : part.status === 'error'
                    ? 'border-destructive/20 bg-destructive/5 text-destructive'
                    : 'border-slate-200 bg-slate-50 text-slate-500'
                )}
              >
                {part.index}: {part.status}
              </span>
            ))}
          </div>
        )}

        {hasVoice && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={selected ? 'default' : 'outline'}
              className="h-8 rounded-xl"
              onClick={() => onPlay(message.id)}
            >
              {selected ? <Volume2 size={14} /> : <PlayCircle size={14} />}
              {selected ? 'Playing' : 'Play voice'}
            </Button>
            {message.audioUrl && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-xl bg-white"
                asChild
              >
                <a href={message.audioUrl} download={`live_reply_${message.id}.wav`}>
                  <Download size={14} />
                  WAV
                </a>
              </Button>
            )}
          </div>
        )}
      </div>

      {isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
          <UserRound size={16} />
        </div>
      )}
    </div>
  );
}

export default function LivePage({ replyMode = 'full' }) {
  const isFastMode = replyMode === 'phrases';
  const [voiceId] = useState(() => getSelectedVoiceId());
  const audioRef = useRef(null);
  const messagesEndRef = useRef(null);

  const liveSpeech = useLiveSpeech({ voiceId, replyMode });
  const playbackReady = liveSpeech.shouldPlayAudio && Boolean(liveSpeech.audioSrc);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [liveSpeech.messages.length, liveSpeech.interimTranscript, liveSpeech.phase]);

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
  }, [liveSpeech.audioSrc, liveSpeech.selectedReplyId, playbackReady]);

  const isReady = Boolean(voiceId);
  const isListening = liveSpeech.phase === 'listening' || liveSpeech.phase === 'thinking';
  const isGeneratingVoice = liveSpeech.phase === 'speaking' && !liveSpeech.audioSrc;
  const buttonDisabled =
    !isReady || liveSpeech.phase === 'connecting' || liveSpeech.phase === 'stopping' || isGeneratingVoice;
  const phaseLabel =
    {
      idle: 'Start',
      connecting: 'Connecting',
      listening: 'Stop',
      thinking: 'Stop',
      speaking: liveSpeech.audioSrc ? 'Interrupt' : 'Generating',
      stopping: 'Stopping',
    }[liveSpeech.phase] || 'Start';
  const statusText =
    liveSpeech.notice ||
    {
      idle: 'Ready for an English voice chat.',
      connecting: 'Connecting to the live assistant...',
      listening: 'Listening...',
      thinking: 'Thinking...',
      speaking: liveSpeech.audioSrc ? 'Playing cloned voice reply...' : 'Preparing cloned voice reply...',
      stopping: 'Stopping conversation...',
    }[liveSpeech.phase] ||
    'Ready for an English voice chat.';

  return (
    <div className="animate-fade-in space-y-6">
      {!isReady && (
        <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          No voice selected.{' '}
          <Link to="/inference" className="font-semibold underline">
            Go to Inference
          </Link>{' '}
          and select a cloned voice first.
        </div>
      )}

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-h-[640px] flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                  <Bot size={18} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-950">
                    {isFastMode ? 'Live Fast Voice Chat' : 'Live Voice Chat'}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {isFastMode
                      ? 'English replies, phrase-by-phrase cloned voice'
                      : 'English replies, full cloned voice output'}
                  </p>
                </div>
              </div>
            </div>
            <Badge className="border border-slate-200 bg-slate-50 text-slate-700 shadow-none">
              {statusText}
            </Badge>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-50 px-4 py-5 sm:px-6">
            {liveSpeech.messages.length === 0 ? (
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-sky-700 shadow-sm">
                  <Mic size={24} />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-950">Start speaking when ready.</h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  {isFastMode
                    ? 'The assistant will listen, reply in English text, then play cloned voice phrases in order as they become ready.'
                    : 'The assistant will listen, reply in English text, then generate one complete cloned voice response.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {liveSpeech.messages.map((message) => (
                  <ChatBubble
                    key={message.id}
                    message={message}
                    selected={liveSpeech.selectedReply?.id === message.id && liveSpeech.phase === 'speaking'}
                    onPlay={liveSpeech.playReply}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {liveSpeech.error && (
            <div className="border-t border-destructive/20 bg-destructive/5 px-5 py-3 text-sm text-destructive">
              {liveSpeech.error}
            </div>
          )}

          <div className="border-t border-slate-200 bg-white px-5 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-950">{statusText}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  While cloned voice is generating or playing, listening pauses. You can interrupt only after playback starts.
                </p>
              </div>

              <div className="flex items-center gap-4">
                <MicLevelMeter level={liveSpeech.audioLevel} active={isListening} />
                <button
                  type="button"
                  className={cn(
                    'flex h-16 w-16 shrink-0 select-none items-center justify-center rounded-full border-4 text-xs font-semibold transition-all',
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
                  <span className="sr-only">{phaseLabel}</span>
                  <Mic size={24} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Activity size={16} className="text-sky-600" />
              <h3 className="text-sm font-semibold text-slate-950">Voice setup</h3>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Voice</p>
                <p className="mt-1 text-slate-800">{voiceId ? 'Selected' : 'Not selected'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Language</p>
                <p className="mt-1 text-slate-800">English only</p>
              </div>
            </div>
          </div>

          <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
            {isFastMode
              ? 'The assistant waits for your phrase to finish, writes one reply, splits it by punctuation, then generates and plays each cloned voice phrase in order.'
              : 'The assistant waits for your phrase to finish, writes one reply, then sends the full text through the normal inference pipeline for one complete cloned voice audio.'}
          </div>

          {!liveSpeech.speechApiAvailable && (
            <div className="rounded-[20px] border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
              This browser does not support live audio processing.
            </div>
          )}
        </aside>
      </section>

      <audio ref={audioRef} className="hidden" onEnded={liveSpeech.onAudioEnded} />
    </div>
  );
}
