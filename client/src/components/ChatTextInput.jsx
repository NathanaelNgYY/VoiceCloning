import { useState } from 'react';
import { Send } from 'lucide-react';

import { MAX_TYPED_MESSAGE_LENGTH } from '@/hooks/liveConversation.js';
import { cn } from '@/lib/utils';

/**
 * Type a question instead of speaking it — the path for anyone without a
 * working microphone. `onSend` opens the conversation by itself when none is
 * running, so this works from a cold start; it returns false when the message
 * could not be sent, in which case the draft is kept so nothing is lost.
 *
 * The reply still comes back as speech in the cloned voice: this replaces the
 * microphone, not the voice.
 *
 * `trailing` renders inside the row after the send button, so a caller can put
 * the mic control on the same line (the gi composer does; see Composer.jsx).
 */
export function ChatTextInput({
  onSend,
  disabled = false,
  placeholder = 'Ask a question…',
  trailing = null,
  className,
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const trimmed = draft.trim();
  const canSubmit = Boolean(trimmed) && !disabled && !sending;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;

    setSending(true);
    try {
      // Opening a session waits on the network, so the field must not clear
      // until the message is actually on its way.
      const sent = await onSend?.(trimmed);
      if (sent !== false) setDraft('');
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('flex w-full items-center gap-2', className)}
    >
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={MAX_TYPED_MESSAGE_LENGTH}
        aria-label="Type your question"
        enterKeyHint="send"
        className={cn(
          'h-11 min-w-0 flex-1 rounded-full border border-slate-200 bg-white px-5 text-sm text-slate-700',
          'shadow-sm outline-none transition placeholder:text-slate-400',
          'focus:border-primary/40 focus:ring-2 focus:ring-primary/20',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400'
        )}
      />
      <button
        type="submit"
        disabled={!canSubmit}
        aria-label="Send message"
        className={cn(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-full transition',
          canSubmit
            ? 'bg-primary text-primary-foreground shadow-sm hover:opacity-90 active:scale-95'
            : 'cursor-not-allowed bg-slate-100 text-slate-300'
        )}
      >
        <Send className="size-4" />
      </button>
      {trailing}
    </form>
  );
}
