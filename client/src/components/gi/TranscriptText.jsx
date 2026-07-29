import { memo } from 'react';
import { cn } from '@/lib/utils';
import {
  SEGMENT_ACTIVE,
  SEGMENT_SPOKEN,
  activeWordIndex,
  segmentPhase,
  spokenWordCount,
} from '@/lib/transcriptReveal';

// Words not yet spoken stay in the layout at low contrast rather than being
// hidden. Revealing them by insertion would reflow the paragraph on every
// timeupdate — the scroll position would jump under the reader's eyes, and the
// panel scrolls independently. Fading in place gives the same "arriving with
// the audio" read with a stable box.
const PENDING = 'text-slate-300';
const SPEAKING = 'rounded bg-primary/10 font-semibold text-primary';

/**
 * A transcript segment that reveals itself in step with playback.
 *
 * Falls back to the plain paragraph when a segment has no word timings, so a
 * lesson that has not been through the offline alignment pass still renders.
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

  // Everything before the playhead is fully read, everything after is fully
  // unread — only the segment under the playhead needs per-word work.
  if (phase !== SEGMENT_ACTIVE) {
    return (
      <span className={phase === SEGMENT_SPOKEN ? baseTone : PENDING}>
        {segment.text}
      </span>
    );
  }

  const spoken = spokenWordCount(segment, currentTime);
  const speakingIndex = activeWordIndex(segment, currentTime);

  return (
    <span className={baseTone}>
      {words.map((word, index) => (
        <span
          key={`${word.start}-${index}`}
          className={cn(
            'transition-colors duration-200',
            index >= spoken && PENDING,
            index === speakingIndex && SPEAKING,
          )}
        >
          {word.text}
          {index < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
});
