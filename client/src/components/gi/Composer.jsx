import { Loader2, Mic, MicOff, PhoneOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Composer({
  disabled,
  active,
  loading = false,
  onStart,
  onStop,
  micMuted = false,
  onToggleMute,
}) {
  const label = loading
    ? 'Connecting to voice assistant'
    : active
      ? 'End voice conversation'
      : 'Start voice conversation';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={label}
          aria-busy={loading}
          onClick={active ? onStop : onStart}
          disabled={loading || (disabled && !active)}
          className={cn(
            'inline-flex size-16 items-center justify-center rounded-full transition disabled:opacity-50',
            active
              ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/25 hover:bg-rose-600'
              : 'bg-primary text-white shadow-lg shadow-primary/25 hover:opacity-90'
          )}
        >
          {loading ? (
            <Loader2 className="size-6 animate-spin" />
          ) : active ? (
            <PhoneOff className="size-5" />
          ) : (
            <Mic className="size-6" />
          )}
        </button>

        {active && (
          <button
            type="button"
            aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
            onClick={onToggleMute}
            className={cn(
              'inline-flex size-10 items-center justify-center rounded-full border transition',
              micMuted
                ? 'border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            )}
          >
            {micMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </button>
        )}
      </div>

      {loading && <span className="text-xs text-ink-muted">Connecting…</span>}
    </div>
  );
}
