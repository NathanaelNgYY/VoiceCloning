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
            // ui-v2 button treatment (white/slate resting, rose while live),
            // scaled up from its 44px inline size — this is the only control on
            // a kiosk screen, so it stays a large centered target.
            'inline-flex size-16 items-center justify-center rounded-full border shadow-sm transition disabled:opacity-50',
            active
              ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700'
              : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700'
          )}
        >
          {loading ? (
            <Loader2 className="size-6 animate-spin text-slate-400" />
          ) : active ? (
            <PhoneOff className="size-6" />
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
              'inline-flex size-11 items-center justify-center rounded-full border transition',
              micMuted
                ? 'border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
            )}
          >
            {micMuted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </button>
        )}
      </div>

      {loading && <span className="text-[10px] text-ink-muted">Connecting…</span>}
    </div>
  );
}
