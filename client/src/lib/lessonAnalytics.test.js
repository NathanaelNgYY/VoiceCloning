import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLessonAnalyticsClient,
  createLessonBehaviorState,
  createRepeatedQuestionTracker,
  createSeekGestureTracker,
  classifyQuestionConcept,
  isClarificationFollowUp,
  questionSimilarity,
} from './lessonAnalytics.js';

test('coalesces one scrubber gesture into one seek from the first start to final destination', () => {
  let scheduled;
  const gestures = [];
  const tracker = createSeekGestureTracker({
    onGesture: (from, to) => gestures.push({ from, to }),
    setTimer: (callback) => { scheduled = callback; return 1; },
    clearTimer: () => {},
  });
  tracker.record(400, 397);
  tracker.record(397, 392);
  tracker.record(392, 380);
  assert.deepEqual(gestures, []);
  scheduled();
  assert.deepEqual(gestures, [{ from: 400, to: 380 }]);
});

test('keeps separate seek gestures separate after the settle window', () => {
  let scheduled;
  const gestures = [];
  const tracker = createSeekGestureTracker({
    onGesture: (from, to) => gestures.push({ from, to }),
    setTimer: (callback) => { scheduled = callback; return 1; },
    clearTimer: () => {},
  });
  tracker.record(400, 380);
  scheduled();
  tracker.record(405, 385);
  scheduled();
  assert.deepEqual(gestures, [{ from: 400, to: 380 }, { from: 405, to: 385 }]);
});

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
  assert.equal(request.options.headers['X-VCS-Entra-Token'], 'verified-token');
  assert.equal(JSON.parse(request.options.body).userId, undefined);
});

test('detects a delayed near-duplicate question without storing it in the signal', () => {
  let timestamp = 0;
  const tracker = createRepeatedQuestionTracker({ now: () => timestamp });
  assert.equal(tracker.record('Why is endoscopy needed for upper GI bleeding?', 380), null);
  timestamp = 12_000;
  const repeated = tracker.record('Explain again why we need endoscopy for an upper GI bleed', 390);
  assert.equal(repeated.previousVideoTime, 380);
  assert.ok(repeated.similarity >= 0.65);
  assert.equal(repeated.semanticConceptId, 'endoscopy');
  assert.equal(repeated.semanticConfidence, 1);
  assert.equal('text' in repeated, false);
});

test('inherits the preceding topic for a short clarification follow-up', () => {
  let timestamp = 0;
  const tracker = createRepeatedQuestionTracker({ now: () => timestamp });
  tracker.record('Can you explain endoscopy timing for upper GI bleeding?', 390);
  timestamp = 12_000;
  const repeated = tracker.record('even simpler', 391);
  assert.equal(repeated.previousVideoTime, 390);
  assert.equal(repeated.similarity, 1);
  assert.equal(repeated.semanticConceptId, 'endoscopy');
  assert.equal(repeated.semanticConfidence, 1);
});

test('recognizes clarification language without treating unrelated short text as a repeat', () => {
  assert.equal(isClarificationFollowUp('Could you explain that again, even simpler?'), true);
  assert.equal(isClarificationFollowUp('thank you'), false);
});

test('classifies clear lesson terms and leaves ambiguous questions unclassified', () => {
  assert.deepEqual(classifyQuestionConcept('Why is endoscopy required?'), {
    conceptId: 'endoscopy',
    confidence: 1,
  });
  assert.equal(classifyQuestionConcept('Can you explain this again?'), null);
  assert.equal(classifyQuestionConcept('Compare endoscopy and colonoscopy'), null);
});

test('ignores accidental rapid duplicates and caps one question cluster at two signals', () => {
  let timestamp = 0;
  const tracker = createRepeatedQuestionTracker({ now: () => timestamp });
  tracker.record('What is endoscopy therapy?', 380);
  timestamp = 2_000;
  assert.equal(tracker.record('What is endoscopy therapy?', 380), null);
  timestamp = 12_000;
  assert.ok(tracker.record('What is endoscopy therapy?', 381));
  timestamp = 24_000;
  assert.ok(tracker.record('What is endoscopy therapy?', 382));
  timestamp = 36_000;
  assert.equal(tracker.record('What is endoscopy therapy?', 383), null);
});

test('question similarity rejects unrelated lesson questions', () => {
  assert.equal(questionSimilarity('Why perform endoscopy?', 'What causes melena?'), 0);
});
