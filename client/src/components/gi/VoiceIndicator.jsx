import { Volume2 } from 'lucide-react';

// `compact` is the in-row variant used where the composer shares a line with
// the voice name; the default stands on its own centred row.
export function VoiceIndicator({ label, compact = false }) {
  const name = String(label || '').trim();
  if (!name) return null;

  if (compact) {
    return (
      <span
        title={`Voice: ${name}`}
        className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-ink shadow-sm"
      >
        <Volume2 className="size-3 shrink-0 text-slate-400" />
        <span className="truncate">{name}</span>
      </span>
    );
  }

  return (
    <p className="flex items-center justify-center gap-2 text-xs text-ink-muted">
      <span className="font-medium text-ink">Voice</span>
      <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-ink shadow-sm">
        {name}
      </span>
    </p>
  );
}
