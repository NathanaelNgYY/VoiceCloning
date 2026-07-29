import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEGMENT_ACTIVE,
  SEGMENT_PENDING,
  SEGMENT_SPOKEN,
  activeWordIndex,
  isRevealIdle,
  revealedSegmentCount,
  revealedWordCount,
  segmentPhase,
  spokenWordCount,
} from './transcriptReveal.js';

const segment = {
  time: 10,
  endTime: 20,
  words: [
    { text: 'Good', start: 10.0, end: 10.4 },
    { text: 'morning', start: 10.4, end: 10.9 },
    { text: 'everyone.', start: 11.5, end: 12.0 },
  ],
};

test('segmentPhase reports pending before the segment starts', () => {
  assert.equal(segmentPhase(segment, 9.99), SEGMENT_PENDING);
});

test('segmentPhase reports active inside the segment', () => {
  assert.equal(segmentPhase(segment, 10), SEGMENT_ACTIVE);
  assert.equal(segmentPhase(segment, 19.99), SEGMENT_ACTIVE);
});

test('segmentPhase reports spoken once the segment has ended', () => {
  assert.equal(segmentPhase(segment, 20), SEGMENT_SPOKEN);
});

test('segmentPhase treats a missing position as pending rather than throwing', () => {
  assert.equal(segmentPhase(segment, undefined), SEGMENT_PENDING);
  assert.equal(segmentPhase(segment, NaN), SEGMENT_PENDING);
});

test('spokenWordCount reveals words as their start times pass', () => {
  assert.equal(spokenWordCount(segment, 9), 0);
  assert.equal(spokenWordCount(segment, 10.0), 1);
  assert.equal(spokenWordCount(segment, 10.4), 2);
  assert.equal(spokenWordCount(segment, 11.4), 2);
  assert.equal(spokenWordCount(segment, 11.5), 3);
});

test('spokenWordCount reveals the whole segment once past the last word', () => {
  assert.equal(spokenWordCount(segment, 500), segment.words.length);
});

test('spokenWordCount collapses to zero when a segment has no timings', () => {
  // A lesson that never went through the offline pass still renders; it just
  // renders as plain text rather than revealing.
  assert.equal(spokenWordCount({ time: 0, endTime: 5 }, 3), 0);
  assert.equal(spokenWordCount({ time: 0, endTime: 5, words: [] }, 3), 0);
});

test('seeking backwards un-reveals words', () => {
  assert.equal(spokenWordCount(segment, 11.6), 3);
  assert.equal(spokenWordCount(segment, 10.2), 1);
});

test('activeWordIndex points at the word currently being spoken', () => {
  assert.equal(activeWordIndex(segment, 10.2), 0);
  assert.equal(activeWordIndex(segment, 10.5), 1);
  assert.equal(activeWordIndex(segment, 11.7), 2);
});

test('activeWordIndex reports nothing during a gap between words', () => {
  // 10.9 -> 11.5 is silence; holding the highlight on "morning" through it
  // makes the transcript look stuck.
  assert.equal(activeWordIndex(segment, 11.2), -1);
});

test('activeWordIndex reports nothing before the first word', () => {
  assert.equal(activeWordIndex(segment, 5), -1);
});

const segments = [
  {
    time: 0,
    endTime: 10,
    words: [
      { text: 'Welcome.', start: 0.5, end: 1.0 },
      { text: 'Today', start: 1.0, end: 1.4 },
    ],
  },
  segment,
  {
    time: 20,
    endTime: 30,
    words: [{ text: 'Next.', start: 20.2, end: 20.8 }],
  },
];

test('revealedSegmentCount leaves segments that have not begun out', () => {
  // The point of the live-caption reveal: at 15s the student can see the first
  // two segments and has no way to read ahead to the third.
  assert.equal(revealedSegmentCount(segments, 15), 2);
});

test('revealedSegmentCount counts a segment the instant it starts', () => {
  assert.equal(revealedSegmentCount(segments, 9.99), 1);
  assert.equal(revealedSegmentCount(segments, 10), 2);
  assert.equal(revealedSegmentCount(segments, 20), 3);
});

test('revealedSegmentCount reveals the whole transcript past the last start', () => {
  assert.equal(revealedSegmentCount(segments, 600), 3);
});

test('revealedSegmentCount survives a missing or empty transcript', () => {
  assert.equal(revealedSegmentCount([], 5), 0);
  assert.equal(revealedSegmentCount(undefined, 5), 0);
  assert.equal(revealedSegmentCount(segments, Number.NaN), 0);
});

test('reveal is idle until the first word is actually spoken', () => {
  // The first segment starts at 0s, so it has "begun" on page load while none
  // of its words have arrived — the panel would otherwise sit blank.
  assert.equal(isRevealIdle(segments, 0), true);
  assert.equal(isRevealIdle(segments, 0.49), true);
  assert.equal(isRevealIdle(segments, 0.5), false);
});

test('reveal is not idle once playback is past the first segment', () => {
  assert.equal(isRevealIdle(segments, 15), false);
});

test('reveal is not idle for a segment with no word timings', () => {
  // Those reveal whole, so having begun is all there is to wait for.
  assert.equal(isRevealIdle([{ time: 0, endTime: 10, text: 'Plain.' }], 0), false);
});

test('revealedWordCount keeps a settled segment whole when seeking back into it', () => {
  // The bug this exists to prevent: clicking an earlier timestamp used to
  // delete the text after it. Having reached 20s, the segment is fully heard,
  // and stays fully rendered no matter where the playhead goes afterwards.
  assert.equal(revealedWordCount(segment, 20), segment.words.length);
  assert.equal(revealedWordCount(segment, 600), segment.words.length);
});

test('revealedWordCount still arrives word by word on the frontier segment', () => {
  assert.equal(revealedWordCount(segment, 10.2), 1);
  assert.equal(revealedWordCount(segment, 10.5), 2);
  assert.equal(revealedWordCount(segment, 11.6), 3);
});

test('revealedWordCount renders nothing for a segment never reached', () => {
  assert.equal(revealedWordCount(segment, 5), 0);
});

test('revealedWordCount collapses to zero without timings', () => {
  assert.equal(revealedWordCount({ time: 0, endTime: 5 }, 3), 0);
  assert.equal(revealedWordCount({ time: 0, endTime: 5, words: [] }, 3), 0);
});

test('the high-water mark never lets the transcript shrink', () => {
  // Watch to 15s, then scrub back to 2s: the first two segments stay unlocked
  // and stay whole, which is the whole point of tracking the furthest point.
  const reached = 15;
  assert.equal(revealedSegmentCount(segments, reached), 2);
  assert.equal(revealedWordCount(segments[0], reached), segments[0].words.length);
  assert.equal(revealedWordCount(segments[1], reached), segments[1].words.length);
  // ...and the third is still locked, so there is nothing to read ahead.
  assert.equal(revealedWordCount(segments[2], reached), 0);
});
