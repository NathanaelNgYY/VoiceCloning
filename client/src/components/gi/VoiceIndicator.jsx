export function VoiceIndicator({ label }) {
  const name = String(label || '').trim();
  if (!name) return null;

  return (
    <p className="flex items-center justify-center gap-2 text-xs text-ink-muted">
      <span className="font-medium text-ink">Voice</span>
      <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-ink shadow-sm">
        {name}
      </span>
    </p>
  );
}
