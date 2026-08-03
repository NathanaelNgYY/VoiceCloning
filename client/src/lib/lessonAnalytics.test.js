import assert from 'node:assert/strict';
import test from 'node:test';

import { createLessonBehaviorState } from './lessonAnalytics.js';

test('lesson behavior reports a two-minute rewind without labeling the learner', () => {
  let timestamp = 1000;
  const behavior = createLessonBehaviorState({ now: () => timestamp });
  behavior.recordSeek(240, 120);
  assert.deepEqual(behavior.getContext(), {
    rewindCount: 1,
    largestBackwardSeekSeconds: 120,
    forwardSkipCount: 0,
    pauseDurationSeconds: 0,
    transcriptReading: false,
  });
});
test('lesson behavior expires seek signals after two minutes', () => {
  let timestamp = 1000;
  const behavior = createLessonBehaviorState({ now: () => timestamp });
  behavior.recordSeek(200, 100);
  timestamp += 120001;
  assert.equal(behavior.getContext().rewindCount, 0);
});

test('lesson behavior distinguishes a long transcript pause from ordinary pausing', () => {
  let timestamp = 1000;
  const behavior = createLessonBehaviorState({ now: () => timestamp });
  behavior.recordPause();
  timestamp += 16000;
  assert.equal(behavior.getContext({ transcriptReading: false }).transcriptReading, false);
  assert.equal(behavior.getContext({ transcriptReading: true }).transcriptReading, true);
  assert.equal(behavior.recordResume(), 16);
});
