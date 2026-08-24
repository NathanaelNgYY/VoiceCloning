import React from 'react';
import { cn } from '@/lib/utils';
import Spinner from './Spinner.jsx';

/**
 * The voices the signed-in lecturer owns, as resolved by the server from their
 * email. A lecturer never sees anyone else's voice; an admin can switch the
 * list to every voice, which the server allows only for the Supervisor role.
 *
 * Presentational: it renders what it is given and reports clicks. Fetching and
 * selection live with the page that owns the voice state.
 */
export default function MyVoicesPanel({
  voices = [],
  isAdmin = false,
  scope = 'mine',
  loading = false,
  error = '',
  selectedVoiceName = '',
  disabled = false,
  trainingUrl = '',
  onSelectVoice = () => {},
  onScopeChange = () => {},
  onRetry = () => {},
}) {
  const showingAll = scope === 'all';

  return (
    <div className="border-b border-slate-100 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
          {showingAll ? 'All voices' : 'My voice'}
        </span>
        {isAdmin && (
          <button
            type="button"
            onClick={() => onScopeChange(showingAll ? 'mine' : 'all')}
            disabled={disabled || loading}
            title="Developers only: list every voice profile, not just your own"
            className={cn(
              'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-40',
              showingAll
                ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
            )}
          >
            {showingAll ? 'Showing all' : 'Show all'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <Spinner size={13} /> Loading your voices…
        </div>
      ) : error ? (
        <div className="mt-2 text-xs text-red-600">
          {error}{' '}
          <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">
            Retry
          </button>
        </div>
      ) : voices.length === 0 ? (
        <div className="mt-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          {showingAll ? (
            'No voice profiles have been saved yet.'
          ) : (
            <>
              <span className="font-semibold text-slate-700">Please train your voice.</span>{' '}
              You have no voice profile yet
              {trainingUrl ? (
                <>
                  {' — '}
                  <a
                    href={trainingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-primary underline underline-offset-2"
                  >
                    open the training app
                  </a>
                  {' '}and record one.
                </>
              ) : (
                '.'
              )}
            </>
          )}
        </div>
      ) : (
        <ul className="mt-2 space-y-1">
          {voices.map((voice) => {
            const isSelected = voice.displayName === selectedVoiceName;
            return (
              <li key={voice.voiceProfileId}>
                <button
                  type="button"
                  onClick={() => onSelectVoice(voice)}
                  disabled={disabled}
                  aria-pressed={isSelected}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-40',
                    isSelected
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-slate-200 bg-white hover:bg-slate-50',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-slate-800">
                      {voice.displayName}
                    </span>
                    {showingAll && (
                      <span className="block truncate text-[11px] text-slate-400">
                        {voice.ownerEmail || 'no owner recorded'}
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      In use
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
