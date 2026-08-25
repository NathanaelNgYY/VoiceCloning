import React from 'react';
import { cn } from '@/lib/utils';
import Spinner from './Spinner.jsx';

/**
 * The voices the signed-in lecturer owns, as resolved by the server from their
 * email. A lecturer never sees anyone else's voice; an admin can switch the
 * list to every voice, which the server allows only for the Supervisor role.
 *
 * Below those sit the standard voices — stock ElevenLabs voices offered to
 * everyone alike. They belong to nobody, need no training, and speak without
 * touching the GPU, so they are listed separately rather than mixed in with a
 * lecturer's own cloned voices.
 *
 * Presentational: it renders what it is given and reports clicks. Fetching and
 * selection live with the page that owns the voice state.
 */
function VoiceButton({ voice, isSelected, disabled, subtitle, onSelect }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(voice)}
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
          {subtitle ? (
            <span className="block truncate text-[11px] text-slate-400">{subtitle}</span>
          ) : null}
        </span>
        {isSelected && (
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-primary">
            In use
          </span>
        )}
      </button>
    </li>
  );
}

function describeStandardVoice(voice) {
  return [voice.gender, voice.accent].filter(Boolean).join(' · ');
}

export default function MyVoicesPanel({
  voices = [],
  standardVoices = [],
  isAdmin = false,
  scope = 'mine',
  loading = false,
  error = '',
  selectedVoiceName = '',
  selectedVoiceProfileId = '',
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
              {standardVoices.length > 0 && ' Until then you can pick a standard voice below.'}
            </>
          )}
        </div>
      ) : (
        <ul className="mt-2 space-y-1">
          {voices.map((voice) => (
            <VoiceButton
              key={voice.voiceProfileId}
              voice={voice}
              isSelected={voice.displayName === selectedVoiceName}
              disabled={disabled}
              onSelect={onSelectVoice}
              subtitle={
                showingAll
                  ? voice.ownerEmail || 'no owner recorded'
                  // Trained, but nobody has picked a reference clip or synthesis
                  // settings for it yet in the TTS page.
                  : voice.hasSavedProfile === false
                    ? 'trained · no saved settings yet'
                    : ''
              }
            />
          ))}
        </ul>
      )}

      {!loading && !error && standardVoices.length > 0 && (
        <div className="mt-3">
          <span className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Standard voices
          </span>
          <p className="mt-1 text-[11px] text-slate-400">
            Ready-made voices — no training needed.
          </p>
          <ul className="mt-2 space-y-1">
            {standardVoices.map((voice) => (
              <VoiceButton
                key={voice.voiceProfileId}
                voice={voice}
                // Matched by id, not display name: a stock voice's name is not
                // unique against a lecturer's own voice names.
                isSelected={voice.voiceProfileId === selectedVoiceProfileId}
                disabled={disabled}
                onSelect={onSelectVoice}
                subtitle={describeStandardVoice(voice)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
