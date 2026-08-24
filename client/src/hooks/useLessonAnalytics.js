import { useCallback, useEffect, useRef } from 'react';

import {
  LONG_PAUSE_SECONDS,
  classifyQuestionConcept,
  createLessonAnalyticsClient,
  createLessonBehaviorState,
  createRepeatedQuestionTracker,
  createSeekGestureTracker,
} from '@/lib/lessonAnalytics.js';
import { acquireApiToken, shouldAttachApiToken } from '@/auth/msalClient';

export function useLessonAnalytics({ slug, videoRef, transcriptScrollRef, activeTab, videoUrl = '' }) {
  const analyticsRef = useRef(null);
  const behaviorRef = useRef(null);
  const activeTabRef = useRef(activeTab);
  const preSeekTimeRef = useRef(null);
  const lastVideoTimeRef = useRef(0);
  const transcriptReviewedRef = useRef(false);
  const repeatedQuestionRef = useRef(null);

  if (!analyticsRef.current) {
    analyticsRef.current = createLessonAnalyticsClient({
      lessonSlug: slug,
      getAuthToken: shouldAttachApiToken() ? acquireApiToken : null,
    });
  }
  if (!behaviorRef.current) behaviorRef.current = createLessonBehaviorState();
  if (!repeatedQuestionRef.current) repeatedQuestionRef.current = createRepeatedQuestionTracker();
  activeTabRef.current = activeTab;

  useEffect(() => {
    const analytics = analyticsRef.current;
    analytics.track('lesson_session_started', { properties: { activeTab } });
    return () => {
      analytics.track('lesson_session_ended');
      void analytics.close();
    };
  }, []); // One analytics session per mounted lesson page.

  useEffect(() => {
    analyticsRef.current.track('lesson_tab_viewed', { properties: { activeTab } });
    if (activeTab !== 'transcript') transcriptReviewedRef.current = false;
  }, [activeTab]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return undefined;
    const analytics = analyticsRef.current;
    const behavior = behaviorRef.current;

    const recordSeek = (fromSeconds, toSeconds) => {
      lastVideoTimeRef.current = toSeconds;
      const seek = behavior.recordSeek(fromSeconds, toSeconds);
      if (!seek) return;
      analytics.track('video_seek', {
        videoTime: toSeconds,
        properties: {
          fromSeconds: Math.round(fromSeconds * 1000) / 1000,
          toSeconds: Math.round(toSeconds * 1000) / 1000,
          deltaSeconds: Math.round(seek.deltaSeconds * 1000) / 1000,
          direction: seek.deltaSeconds < 0 ? 'backward' : 'forward',
        },
      });
    };
    const seekGesture = createSeekGestureTracker({ onGesture: recordSeek });

    const onTimeUpdate = () => {
      if (!video.seeking) lastVideoTimeRef.current = video.currentTime;
    };
    const onPlay = () => {
      seekGesture.flush();
      const pauseDurationSeconds = behavior.recordResume();
      analytics.track('video_play', {
        videoTime: video.currentTime,
        properties: pauseDurationSeconds >= LONG_PAUSE_SECONDS ? { pauseDurationSeconds } : {},
      });
    };
    const onPause = () => {
      if (video.ended) return;
      behavior.recordPause();
      analytics.track('video_pause', { videoTime: video.currentTime });
    };
    const onSeeking = () => {
      preSeekTimeRef.current = lastVideoTimeRef.current;
    };
    const onSeeked = () => {
      const fromSeconds = preSeekTimeRef.current;
      const toSeconds = video.currentTime;
      preSeekTimeRef.current = null;
      seekGesture.record(fromSeconds, toSeconds);
    };
    const onEnded = () => analytics.track('video_ended', { videoTime: video.currentTime });

    lastVideoTimeRef.current = video.currentTime;
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ended', onEnded);
      seekGesture.cancel();
    };
  }, [videoRef, videoUrl]);

  useEffect(() => {
    const panel = transcriptScrollRef.current;
    if (!panel) return undefined;
    let timer = null;
    const onScroll = () => {
      if (activeTabRef.current !== 'transcript' || transcriptReviewedRef.current) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        transcriptReviewedRef.current = true;
        analyticsRef.current.track('transcript_scrolled', {
          videoTime: videoRef.current?.currentTime,
        });
      }, 1000);
    };
    panel.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      panel.removeEventListener('scroll', onScroll);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [transcriptScrollRef, videoRef, videoUrl]);

  const trackNavigation = useCallback((source, targetSeconds) => {
    analyticsRef.current.track('lesson_navigation', {
      videoTime: targetSeconds,
      properties: { source },
    });
  }, []);

  const getBehaviorContext = useCallback(() => behaviorRef.current.getContext({
    transcriptReading: activeTabRef.current === 'transcript',
  }), []);

  const recordQuestion = useCallback((text) => {
    const videoTime = videoRef.current?.currentTime;
    const classification = classifyQuestionConcept(text);
    const repeated = repeatedQuestionRef.current.record(text, videoTime);
    analyticsRef.current.track('question_asked', {
      videoTime,
      properties: {
        questionText: String(text || '').trim(),
        semanticConceptId: classification?.conceptId || '',
        semanticConfidence: classification?.confidence || 0,
        isRepeated: Boolean(repeated),
      },
    });
    if (!repeated) return false;
    analyticsRef.current.track('repeated_question', {
      videoTime,
      properties: {
        previousVideoTime: repeated.previousVideoTime,
        similarity: repeated.similarity,
        timeSincePreviousSeconds: Math.round(repeated.elapsedSeconds * 10) / 10,
        semanticConceptId: repeated.semanticConceptId,
        semanticConfidence: repeated.semanticConfidence,
      },
    });
    return true;
  }, [videoRef]);

  return { trackNavigation, getBehaviorContext, recordQuestion };
}
