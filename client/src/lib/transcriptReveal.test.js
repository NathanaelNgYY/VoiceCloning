import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEGMENT_ACTIVE,
  SEGMENT_PENDING,
  SEGMENT_SPOKEN,
  activeWordIndex,
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
