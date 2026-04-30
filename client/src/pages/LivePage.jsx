import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCurrentInference, getInferenceStatus } from '../services/api.js';
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
  MicOff,
  PlayCircle,
  Square,
  UserRound,
  Volume2,
  VolumeX,
} from 'lucide-react';

const INFERENCE_DRAFT_KEY = 'voice-cloning-inference-draft';

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
  const [serverReady, setServerReady] = useState(false);
  const [loadedVoiceName, setLoadedVoiceName] = useState('');
  const [refParams, setRefParams] = useState(null);
  const audioRef = useRef(null);
  const messagesEndRef = useRef(null);

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
            aux_ref_audio_paths: params.aux_ref_audio_paths || [],
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
              aux_ref_audio_paths: (draft.auxRefAudios || []).map((file) => file.path),
            });
          }
        }
      } catch {
        // Ignore stale local draft data.
      }
    }
    init();
  }, []);

  const liveSpeech = useLiveSpeech({ refParams, replyMode });
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

  const isReady = serverReady && Boolean(refParams);
  const isConversationActive = liveSpeech.phase !== 'idle';
  const isListening = liveSpeech.isMicInputEnabled
    && (liveSpeech.phase === 'listening' || liveSpeech.phase === 'thinking');
  const canBargeIn = liveSpeech.isMicInputEnabled || liveSpeech.isBargeInArmed;
  const meterActive = (liveSpeech.isMicInputEnabled
    && (liveSpeech.phase === 'listening' || liveSpeech.phase === 'thinking'))
    || (canBargeIn && liveSpeech.phase === 'speaking');
  const buttonDisabled =
    !isReady || liveSpeech.phase === 'connecting' || liveSpeech.phase === 'stopping';
  const phaseLabel =
    {
      idle: 'Start',
      connecting: 'Connecting',
      listening: liveSpeech.isMicInputEnabled ? 'Mic on' : 'Mic off',
      thinking: liveSpeech.isMicInputEnabled ? 'Mic on' : 'Mic off',
      speaking: liveSpeech.isMicInputEnabled ? 'Mic on' : 'Mic off',
      stopping: 'Stopping',
    }[liveSpeech.phase] || 'Start';
  const statusText =
    liveSpeech.notice ||
    (!liveSpeech.isMicInputEnabled && isConversationActive && liveSpeech.phase !== 'speaking'
      ? 'Mic off. Voice chat is still open.'
      : '') ||
    {
      idle: 'Ready for an English voice chat.',
      connecting: 'Connecting to the live assistant...',
      listening: liveSpeech.isMicInputEnabled ? 'Listening...' : 'Mic off. Voice chat is still open.',
      thinking: 'Thinking...',
      speaking: liveSpeech.audioSrc
        ? canBargeIn
          ? 'Playing cloned voice reply. Speak to interrupt.'
          : 'Playing cloned voice reply...'
        : 'Preparing cloned voice reply...',
      stopping: 'Stopping conversation...',
    }[liveSpeech.phase] ||
    'Ready for an English voice chat.';

  return (
    <div className="animate-fade-in space-y-6">
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
                  {canBargeIn && liveSpeech.phase === 'speaking'
                    ? 'Speak over playback to stop it and start your next turn.'
                    : liveSpeech.isMicInputEnabled
                    ? 'Mic input is available when the assistant is listening.'
                    : 'Mic input is off; voice playback can continue.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                {playbackReady && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-xl border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                    onClick={liveSpeech.interruptPlayback}
                  >
                    <VolumeX size={14} />
                    Stop voice
                  </Button>
                )}
                {isConversationActive && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-xl border-slate-200 bg-white text-slate-600"
                    onClick={liveSpeech.stop}
                  >
                    <Square size={13} />
                    End
                  </Button>
                )}
                <MicLevelMeter level={liveSpeech.audioLevel} active={meterActive} />
                <button
                  type="button"
                  className={cn(
                    'flex h-16 w-16 shrink-0 select-none items-center justify-center rounded-full border-4 text-xs font-semibold transition-all',
                    buttonDisabled
                      ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                      : isConversationActive && !liveSpeech.isMicInputEnabled
                        ? 'cursor-pointer border-slate-300 bg-slate-50 text-slate-500 shadow-[0_0_0_8px_rgba(100,116,139,0.12)] active:scale-95'
                        : isListening
                        ? 'border-red-400 bg-red-50 text-red-600 shadow-[0_0_0_8px_rgba(239,68,68,0.15)]'
                        : isConversationActive
                        ? 'cursor-pointer border-slate-300 bg-white text-slate-700 shadow-[0_0_0_8px_rgba(100,116,139,0.12)] active:scale-95'
                        : 'cursor-pointer border-sky-300 bg-sky-50 text-sky-700 shadow-[0_18px_50px_-20px_rgba(14,165,233,0.5)] hover:shadow-[0_18px_50px_-20px_rgba(14,165,233,0.7)] active:scale-95'
                  )}
                  onClick={liveSpeech.toggle}
                  disabled={buttonDisabled}
                  aria-pressed={liveSpeech.isMicInputEnabled}
                  title={phaseLabel}
                >
                  <span className="sr-only">{phaseLabel}</span>
                  {liveSpeech.isMicInputEnabled || liveSpeech.phase === 'idle'
                    ? <Mic size={24} />
                    : <MicOff size={24} />}
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
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model</p>
                <p className="mt-1 text-slate-800">{serverReady ? loadedVoiceName || 'Loaded' : 'Not loaded'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reference</p>
                <p className="mt-1 break-all text-slate-800">
                  {refParams?.ref_audio_path
                    ? refParams.ref_audio_path.replace(/\\/g, '/').split('/').pop()
                    : 'Not selected'}
                </p>
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
