import { Loader2, Mic, MicOff, Square, VolumeX } from 'lucide-react';
import { ChatTextInput } from '@/components/ChatTextInput.jsx';
import { cn } from '@/lib/utils';

// Shared treatment for the two labelled pills that sit above the composer row
// while a conversation is live ("Stop voice" and "End").
const PILL_CLASS =
  'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border '
  + 'border-slate-200 bg-white px-3 text-xs font-medium shadow-sm transition';

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
  onSendText,
  canSendText = false,
}) {
  // Idle, the mic starts the conversation; live, it mutes and unmutes. Ending
  // is the "End" pill's job, so one tap can never throw away a live session.
  const micLabel = loading
    ? 'Connecting to voice assistant'
    : !active
      ? 'Start voice conversation'
      : micMuted
        ? 'Unmute microphone'
        : 'Mute microphone';

  const micButton = (
    <button
      type="button"
      aria-label={micLabel}
      aria-busy={loading}
      onClick={active ? onToggleMute : onStart}
      disabled={loading || (disabled && !active)}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        active && micMuted
          // Muted is the one state that must not read as "ready to listen", so
          // it steps out of the primary fill entirely.
          ? 'border border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100'
          : 'bg-primary text-primary-foreground shadow-sm hover:opacity-90 active:scale-95',
        active && !micMuted && 'ring-2 ring-primary/30'
      )}
    >
      {loading ? (
        <Loader2 className="size-5 animate-spin" />
      ) : active && micMuted ? (
        <MicOff className="size-5" />
      ) : (
        <Mic className="size-5" />
      )}
    </button>
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl shrink-0 flex-col items-center gap-2">
      {/* Session controls ride above the composer row rather than inside it:
          the row itself stays the same shape whether or not a conversation is
          running, so the input never shifts sideways mid-sentence as these
          appear and disappear. */}
      {(active || loading) && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
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

          {active && (
            <button
              type="button"
              onClick={onStop}
              className={cn(PILL_CLASS, 'text-slate-700 hover:bg-slate-50')}
            >
              <Square className="size-3" />
              End
            </button>
          )}

          {loading && <span className="text-[10px] text-ink-muted">Connecting…</span>}
        </div>
      )}

      {/* Typing and the mic share one row, with no Voice/Text mode toggle: a
          kiosk visitor whose microphone does not work should not have to find
          a setting before they can ask anything. Either control opens the
          conversation on its own. */}
      <ChatTextInput
        onSend={onSendText}
        disabled={!canSendText || !onSendText}
        trailing={micButton}
      />
    </div>
  );
}
