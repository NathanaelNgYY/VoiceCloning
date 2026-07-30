import { memo } from 'react';
import { cn } from '@/lib/utils';
import {
  SEGMENT_ACTIVE,
  SEGMENT_PENDING,
  activeWordIndex,
  revealedWordCount,
  segmentPhase,
} from '@/lib/transcriptReveal';

// Unspoken words are not rendered at all — the transcript should read like a
// live transcription, where you cannot see what has not been said yet. Words
// fade in as they arrive rather than popping, and a caret marks the leading
// edge so a pause between words looks like waiting rather than like a stall.
//
// The reflow this causes is contained: appending to the end of a paragraph
// leaves every earlier word where it was, and only the frontier segment ever
// grows. LessonPage keeps that segment in view.
const SPEAKING = 'rounded bg-primary/10 font-semibold text-primary';

/**
 * A transcript segment that reveals itself in step with playback.
 *
 * Two clocks, deliberately: how much text exists comes from `reachedTime`, the
 * furthest point playback has got to, so seeking backwards never un-hears a
 * sentence. Which word is lit comes from `currentTime`, so a scrub still shows
 * the student where they are.
 *
 * Falls back to the plain paragraph when a segment has no word timings, so a
 * lesson that has not been through the offline alignment pass still renders —
 * it arrives a segment at a time instead of a word at a time.
 */
export const TranscriptText = memo(function TranscriptText({
  segment,
  currentTime,
  reachedTime,
  isActiveSegment,
}) {
  const words = segment?.words;
  const baseTone = isActiveSegment ? 'font-medium text-slate-800' : 'text-slate-500';

  if (!Array.isArray(words) || words.length === 0) {
    return <span className={baseTone}>{segment?.text}</span>;
  }

  const revealPhase = segmentPhase(segment, reachedTime);

  // A segment the student has never reached is rendered by LessonPage as a
  // header-only row, not through here — but stay quiet rather than leak it.
  if (revealPhase === SEGMENT_PENDING) return null;

  const revealed = revealedWordCount(segment, reachedTime);

  // Settled segments are plain text: no per-word spans, no stale caret.
  if (revealPhase !== SEGMENT_ACTIVE && !isActiveSegment) {
    return <span className={baseTone}>{segment.text}</span>;
  }

  const speakingIndex = isActiveSegment ? activeWordIndex(segment, currentTime) : -1;
  const isFrontier = revealPhase === SEGMENT_ACTIVE;

  return (
    <span className={baseTone}>
      {words.slice(0, revealed).map((word, index) => (
        <span
          key={`${word.start}-${index}`}
          className={cn(
            'gi-transcript-word',
            index === speakingIndex && SPEAKING,
          )}
        >
          {word.text}
          {index < words.length - 1 ? ' ' : ''}
        </span>
      ))}
      {isFrontier && revealed < words.length && (
        <span className="gi-transcript-caret" aria-hidden="true" />
      )}
    </span>
  );
});
