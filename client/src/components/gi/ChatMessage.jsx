import { cn } from '@/lib/utils';

const BUSY_STATUSES = ['thinking', 'generating_voice', 'transcribing', 'listening'];

export function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  const isBusy = BUSY_STATUSES.includes(message.status);
  const isEmpty = !message.text;

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
      </div>
    </div>
  );
}
