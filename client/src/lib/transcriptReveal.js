// Decides how much of a transcript segment has been spoken at a given playback
// position, so the transcript can reveal itself in step with the video.
//
// Kept out of the component because the interesting part is the boundary
// behaviour — seeking backwards, a paused video, a segment with no word
// timings — and that is worth testing without rendering anything.

/** A segment is entirely in the past / entirely in the future / mid-read. */
export const SEGMENT_SPOKEN = 'spoken';
export const SEGMENT_PENDING = 'pending';
export const SEGMENT_ACTIVE = 'active';

/**
 * Index of the first word whose start is after `seconds`, over a sorted array.
 *
 * Both callers below want the same "how much of this has happened" answer over
 * a monotonic list, differing only in which field they read.
 */
function countStartedBy(items, seconds, readStart) {
  if (!Array.isArray(items) || items.length === 0) return 0;

  const at = Number(seconds);
  if (!Number.isFinite(at)) return 0;
  if (at < readStart(items[0])) return 0;
  if (at >= readStart(items[items.length - 1])) return items.length;

  // Highest index whose start <= at, plus one.
  let low = 0;
  let high = items.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (readStart(items[mid]) <= at) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/**
 * Where `seconds` sits relative to one segment.
 *
 * Callers use this to skip per-word work for the ~17 of 18 segments that are
 * uniformly past or future on any given frame — only the active one needs its
 * words walked.
 */
export function segmentPhase(segment, seconds) {
  const start = Number(segment?.time);
  const end = Number(segment?.endTime);
  const at = Number(seconds);
  if (!Number.isFinite(at) || !Number.isFinite(start)) return SEGMENT_PENDING;
  if (at < start) return SEGMENT_PENDING;
  if (Number.isFinite(end) && at >= end) return SEGMENT_SPOKEN;
  return SEGMENT_ACTIVE;
}

/**
 * How many words of `segment` have started by `seconds`.
 *
 * Returns a count rather than a per-word list so a re-render on every
 * timeupdate compares one integer instead of walking 1290 objects. Word starts
 * are monotonic (guaranteed by the offline alignment pass), so this is a
 * binary search rather than a scan.
 */
export function spokenWordCount(segment, seconds) {
  return countStartedBy(segment?.words, seconds, (word) => Number(word.start));
}

/**
 * How many segments have begun by `seconds`.
 *
 * The panel reads as live captions: a segment that has not started is not in
 * the DOM at all, so the transcript grows with the lecture instead of showing
 * the student what is about to be said. A count rather than a filtered array
 * keeps the caller's slice cheap and its React keys stable.
 */
export function revealedSegmentCount(segments, seconds) {
  return countStartedBy(segments, seconds, (segment) => Number(segment.time));
}

/**
 * True when nothing has been spoken yet, so the panel can explain itself rather
 * than sit empty before the student has pressed play.
 *
 * Deliberately not `revealedSegmentCount === 0`: the first segment starts at
 * 0s, so it counts as begun the moment the page loads while none of its words
 * have arrived.
 */
export function isRevealIdle(segments, seconds) {
  const revealed = revealedSegmentCount(segments, seconds);
  if (revealed === 0) return true;
  if (revealed > 1) return false;

  // A segment with no timings reveals whole, so having begun is enough.
  const first = segments[0];
  if (!Array.isArray(first?.words) || first.words.length === 0) return false;
  return spokenWordCount(first, seconds) === 0;
}

/**
 * Index of the word being spoken at `seconds`, or -1.
 *
 * Distinct from `spokenWordCount() - 1`: in the gap between two words nothing
 * is being spoken, and highlighting the previous word through a pause makes the
 * transcript look stuck.
 */
export function activeWordIndex(segment, seconds) {
  const words = segment?.words;
  if (!Array.isArray(words) || words.length === 0) return -1;

  const count = spokenWordCount(segment, seconds);
  if (count === 0) return -1;

  const index = count - 1;
  const at = Number(seconds);
  const end = Number(words[index].end);
  if (Number.isFinite(end) && at > end) return -1;
  return index;
}
