import { Loader2, Mic, MicOff, Square, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';

// Shared treatment for the two labelled pills that flank the mic while a
// conversation is live ("Stop voice" and "End").
const PILL_CLASS =
  'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border '
  + 'border-slate-200 bg-white px-3.5 text-xs font-medium shadow-sm transition';

export function Composer({
  disabled,
  active,
  loading = false,
  onStart,
  onStop,
  micMuted = false,
  onToggleMute,
  playbackReady = false,
  onStopVoice,
}) {
  const label = loading
    ? 'Connecting to voice assistant'
    : active
      ? 'End voice conversation'
      : 'Start voice conversation';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center justify-center gap-3">
        {/* Fixed-width flankers keep the mic circle centred, so the row does not
            shift sideways as Stop voice appears and disappears between clips. */}
        {active && (
          <div className="flex w-28 justify-end">
            {playbackReady && (
              <button
                type="button"
                onClick={onStopVoice}
                className={cn(PILL_CLASS, 'text-slate-500 hover:border-slate-300 hover:text-slate-800')}
              >
                <VolumeX className="size-3.5" />
                Stop voice
              </button>
            )}
          </div>
        )}

        {active && (
          <button
            type="button"
            aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
            onClick={onToggleMute}
            className={cn(
              'inline-flex size-11 shrink-0 items-center justify-center rounded-full border transition',
              micMuted
                ? 'border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
            )}
          >
            {micMuted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </button>
        )}

        <div className={cn(active && 'flex w-28 justify-start')}>
          <button
            type="button"
            aria-label={label}
            aria-busy={loading}
            onClick={active ? onStop : onStart}
            disabled={loading || (disabled && !active)}
            className={cn(
              // ui-v2 button treatment. Idle/connecting is a large circular mic —
              // this is the only control on a kiosk screen, so it stays a big
              // centered target. While live it becomes a labelled "End" pill.
              active
                ? cn(PILL_CLASS, 'text-slate-700 hover:bg-slate-50 disabled:opacity-50')
                : 'inline-flex size-16 items-center justify-center rounded-full border border-slate-200 '
                  + 'bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50'
            )}
          >
            {loading ? (
              <Loader2 className="size-6 animate-spin text-slate-400" />
            ) : active ? (
              <>
                <Square className="size-3.5" />
                End
              </>
            ) : (
              <Mic className="size-6" />
            )}
          </button>
        </div>
      </div>

      {loading && <span className="text-[10px] text-ink-muted">Connecting…</span>}
    </div>
  );
}
