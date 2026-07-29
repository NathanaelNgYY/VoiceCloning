import { memo } from 'react';
import { cn } from '@/lib/utils';
import {
  SEGMENT_ACTIVE,
  SEGMENT_PENDING,
  activeWordIndex,
  segmentPhase,
  spokenWordCount,
} from '@/lib/transcriptReveal';

// Unspoken words are not rendered at all — the transcript should read like a
// live transcription, where you cannot see what has not been said yet. Words
// fade in as they arrive rather than popping, and a caret marks the leading
// edge so a pause between words looks like waiting rather than like a stall.
//
// The reflow this causes is contained: appending to the end of a paragraph
// leaves every earlier word where it was, and there is nothing rendered below
// the active segment to be pushed down. LessonPage follows the growing edge.
const SPEAKING = 'rounded bg-primary/10 font-semibold text-primary';

/**
 * A transcript segment that reveals itself in step with playback.
 *
 * Falls back to the plain paragraph when a segment has no word timings, so a
 * lesson that has not been through the offline alignment pass still renders —
 * it arrives a segment at a time instead of a word at a time.
 */
export const TranscriptText = memo(function TranscriptText({
  segment,
  currentTime,
  isActiveSegment,
}) {
  const words = segment?.words;
  const baseTone = isActiveSegment ? 'font-medium text-slate-800' : 'text-slate-500';

  if (!Array.isArray(words) || words.length === 0) {
    return <span className={baseTone}>{segment?.text}</span>;
  }

  const phase = segmentPhase(segment, currentTime);

  // Only the segment under the playhead needs per-word work; everything behind
  // it is fully read. A pending segment should have been filtered out by the
  // caller, but render nothing rather than leak it if one slips through.
  if (phase !== SEGMENT_ACTIVE) {
    if (phase === SEGMENT_PENDING) return null;
    return <span className={baseTone}>{segment.text}</span>;
  }

  const spoken = spokenWordCount(segment, currentTime);
  const speakingIndex = activeWordIndex(segment, currentTime);

  return (
    <span className={baseTone}>
      {words.slice(0, spoken).map((word, index) => (
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
      <span className="gi-transcript-caret" aria-hidden="true" />
    </span>
  );
});
