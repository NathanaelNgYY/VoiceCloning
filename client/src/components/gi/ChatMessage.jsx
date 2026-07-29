import { PlayCircle, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const BUSY_STATUSES = ['thinking', 'generating_voice', 'transcribing', 'listening'];

export function ChatMessage({ message, speaking = false, onPlay }) {
  const isUser = message.role === 'user';
  const isBusy = BUSY_STATUSES.includes(message.status);
  const isEmpty = !message.text;

  // A reply is replayable once any clip has landed — phrase mode streams the
  // answer as audioParts, so the whole-message audioUrl is often absent.
  const hasVoice =
    !isUser
    && Boolean(onPlay)
    && (Boolean(message.audioUrl) || (message.audioParts || []).some((part) => part.audioUrl));

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed sm:text-sm',
          isUser
            ? 'bg-primary text-white'
            : 'border border-slate-200 bg-white text-ink shadow-sm'
        )}
      >
        {isBusy && isEmpty ? (
          <span className="flex items-center gap-1 py-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cn(
                  'size-1.5 animate-bounce rounded-full',
                  isUser ? 'bg-white/80' : 'bg-slate-400'
                )}
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
        )}

        {message.error && (
          <p className={cn('mt-1.5 text-[10px] sm:text-[11px]', isUser ? 'text-white/80' : 'text-red-600')}>
            {message.error}
          </p>
        )}

        {hasVoice && (
          <button
            type="button"
            onClick={() => onPlay(message.id)}
            className={cn(
              'mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors',
              speaking
                ? 'bg-slate-900 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300'
            )}
          >
            {speaking ? <Volume2 className="size-3" /> : <PlayCircle className="size-3" />}
            {speaking ? 'Playing' : 'Play voice'}
          </button>
        )}
      </div>
    </div>
  );
}
