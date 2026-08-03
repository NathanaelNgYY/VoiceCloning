import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLessonVideoContext,
  describeSpokenDuration,
  formatLessonTimestamp,
  isVideoPositionSharingEnabled,
  resolveLessonEndSeconds,
  shouldSendVideoPosition,
} from './lessonVideoContext.js';

const COURSE = {
  title: 'Gastrointestinal Bleeding 101',
  description: 'Clinical overview of upper and lower GI bleeding.',
  topics: [
    { time: 0, label: 'Introduction & Overview' },
    { time: 505.88, label: 'Lower GI Bleeding' },
  ],
  transcriptSegments: [
    { time: 0, endTime: 23.45, title: 'Introduction', text: 'Good morning everyone.' },
    { time: 505.88, endTime: 673.04, title: 'Lower GI', text: 'Bleeding distal to the ligament of Treitz.' },
  ],
};

test('formatLessonTimestamp renders minutes and zero-padded seconds', () => {
  assert.equal(formatLessonTimestamp(0), '0:00');
  assert.equal(formatLessonTimestamp(65.14), '1:05');
  assert.equal(formatLessonTimestamp(673.04), '11:13');
});

test('formatLessonTimestamp floors negative and unusable values to 0:00', () => {
  assert.equal(formatLessonTimestamp(-5), '0:00');
  assert.equal(formatLessonTimestamp(undefined), '0:00');
  assert.equal(formatLessonTimestamp('nope'), '0:00');
});

test('describeSpokenDuration reads as speech, not as a clock', () => {
  assert.equal(describeSpokenDuration(673.04), '11 minutes and 13 seconds');
  assert.equal(describeSpokenDuration(120), '2 minutes');
  assert.equal(describeSpokenDuration(61), '1 minute and 1 second');
});

test('resolveLessonEndSeconds takes the furthest transcript end', () => {
  assert.equal(resolveLessonEndSeconds(COURSE), 673.04);
  assert.equal(resolveLessonEndSeconds(null), 0);
});

test('resolveLessonEndSeconds falls back to segment starts when endTime is missing', () => {
  assert.equal(
    resolveLessonEndSeconds({ transcriptSegments: [{ time: 10 }, { time: 42 }] }),
    42
  );
});

test('buildLessonVideoContext tags every segment with a start-to-end range', () => {
  const context = buildLessonVideoContext(COURSE);
  assert.match(context, /\[0:00 to 0:23\] Introduction — Good morning everyone\./);
  assert.match(context, /\[8:25 to 11:13\] Lower GI — Bleeding distal to the ligament of Treitz\./);
});

test('buildLessonVideoContext includes the title, outline, and spoken length', () => {
  const context = buildLessonVideoContext(COURSE);
  assert.match(context, /Gastrointestinal Bleeding 101/);
  assert.match(context, /\[8:25\] Lower GI Bleeding/);
  assert.match(context, /about 11 minutes and 13 seconds long and ends at 11:13/);
});

test('buildLessonVideoContext returns empty when there is no transcript', () => {
  assert.equal(buildLessonVideoContext(null), '');
  assert.equal(buildLessonVideoContext({ title: 'Empty', transcriptSegments: [] }), '');
  assert.equal(buildLessonVideoContext({ transcriptSegments: [{ time: 0, text: '   ' }] }), '');
});

test('buildLessonVideoContext survives the gateway flattening whitespace', () => {
  // live-gateway collapses /\s+/g -> ' ' before sending instructions, so each
  // segment must still be delimited without its leading newline.
  const flattened = buildLessonVideoContext(COURSE).replace(/\s+/g, ' ');
  assert.match(flattened, /\[0:00 to 0:23\] Introduction — Good morning everyone\. \[8:25 to 11:13\]/);
});

test('buildLessonVideoContext caps the block length', () => {
  const context = buildLessonVideoContext(COURSE, { maxChars: 50 });
  assert.equal(context.length, 50);
});

test('buildLessonVideoContext covers both ways of asking about a moment', () => {
  const context = buildLessonVideoContext(COURSE);
  // Named timestamp.
  assert.match(context, /When the student names a time/);
  // Unnamed, resolved from a live position note — with a fallback when none came.
  assert.match(context, /answer about the point in the most recent note/);
  assert.match(context, /If no note has arrived, ask them which timestamp they mean/);
});

test('shouldSendVideoPosition always sends the first reading', () => {
  assert.equal(shouldSendVideoPosition({ seconds: 0, paused: true }, null), true);
});

test('shouldSendVideoPosition suppresses readings that barely moved', () => {
  const last = { seconds: 100, paused: false };
  assert.equal(shouldSendVideoPosition({ seconds: 101, paused: false }, last), false);
  assert.equal(shouldSendVideoPosition({ seconds: 102, paused: false }, last), true);
});

test('shouldSendVideoPosition lets a pause or resume through immediately', () => {
  const last = { seconds: 100, paused: false };
  assert.equal(shouldSendVideoPosition({ seconds: 100.2, paused: true }, last), true);
});

test('shouldSendVideoPosition lets a backwards seek through', () => {
  const last = { seconds: 100, paused: false };
  assert.equal(shouldSendVideoPosition({ seconds: 30, paused: false }, last), true);
});

test('shouldSendVideoPosition sends a changed learning signal at the same timestamp', () => {
  const last = { seconds: 100, paused: true, behavior: { rewindCount: 0 } };
  const next = { seconds: 100, paused: true, behavior: { rewindCount: 1 } };
  assert.equal(shouldSendVideoPosition(next, last), true);
});

test('shouldSendVideoPosition ignores an unreadable position', () => {
  assert.equal(shouldSendVideoPosition(null, null), false);
  assert.equal(shouldSendVideoPosition({ seconds: NaN }, null), false);
});

test('isVideoPositionSharingEnabled defaults on and respects opt-out values', () => {
  assert.equal(isVideoPositionSharingEnabled({}), true);
  assert.equal(isVideoPositionSharingEnabled({ VITE_GI_VIDEO_POSITION: 'true' }), true);
  assert.equal(isVideoPositionSharingEnabled({ VITE_GI_VIDEO_POSITION: 'false' }), false);
  assert.equal(isVideoPositionSharingEnabled({ VITE_GI_VIDEO_POSITION: '0' }), false);
  assert.equal(isVideoPositionSharingEnabled({ VITE_GI_VIDEO_POSITION: 'OFF' }), false);
});
