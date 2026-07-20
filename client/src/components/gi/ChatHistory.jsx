import { SquarePen } from 'lucide-react';

export function ChatHistory({ onNewChat }) {
  return (
    <div className="flex h-full flex-col gap-3">
      <h1 className="px-1 pr-10 text-sm font-semibold text-primary">GI Bleeding</h1>

      <button
        type="button"
        onClick={onNewChat}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-primary transition hover:bg-slate-100"
      >
        <SquarePen className="size-4" />
        New Chat
      </button>

      <p className="px-1 text-xs font-medium uppercase tracking-wide text-ink-muted">History</p>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        <p className="px-1 text-xs text-ink-muted">
          This session only — conversations are not saved.
        </p>
      </div>
    </div>
  );
}
