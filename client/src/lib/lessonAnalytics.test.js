import assert from 'node:assert/strict';
import test from 'node:test';

import { createLessonAnalyticsClient, createLessonBehaviorState } from './lessonAnalytics.js';

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

test('identified analytics attaches the backend token and never trusts a browser user id', async () => {
  let request;
  const analytics = createLessonAnalyticsClient({
    lessonSlug: 'gi-bleeding',
    getAuthToken: async () => 'verified-token',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true };
    },
  });
  analytics.track('video_seek', {
    videoTime: 175,
    properties: { direction: 'backward', fromSeconds: 180, toSeconds: 170 },
  });

  assert.equal(await analytics.flush(), true);
  assert.equal(request.url, '/api/analytics/events');
  assert.equal(request.options.headers.Authorization, 'Bearer verified-token');
  assert.equal(JSON.parse(request.options.body).userId, undefined);
});
