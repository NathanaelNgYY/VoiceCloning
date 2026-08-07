import { useCallback, useEffect, useRef } from 'react';

import {
  LONG_PAUSE_SECONDS,
  createLessonAnalyticsClient,
  createLessonBehaviorState,
  createRepeatedQuestionTracker,
} from '@/lib/lessonAnalytics.js';
import { acquireApiToken, shouldAttachApiToken } from '@/auth/msalClient';

export function useLessonAnalytics({ slug, videoRef, transcriptScrollRef, activeTab, videoUrl = '' }) {
  const analyticsRef = useRef(null);
  const behaviorRef = useRef(null);
  const activeTabRef = useRef(activeTab);
  const preSeekTimeRef = useRef(null);
  const lastVideoTimeRef = useRef(0);
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
  }, [activeTab]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return undefined;
    const analytics = analyticsRef.current;
    const behavior = behaviorRef.current;

    const onTimeUpdate = () => {
      if (!video.seeking) lastVideoTimeRef.current = video.currentTime;
    };
    const onPlay = () => {
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
    };
  }, [videoRef, videoUrl]);

  useEffect(() => {
    const panel = transcriptScrollRef.current;
    if (!panel) return undefined;
    let timer = null;
    const onScroll = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
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
    const repeated = repeatedQuestionRef.current.record(text, videoTime);
    if (!repeated) return false;
    analyticsRef.current.track('repeated_question', {
      videoTime,
      properties: {
        previousVideoTime: repeated.previousVideoTime,
        similarity: repeated.similarity,
        timeSincePreviousSeconds: Math.round(repeated.elapsedSeconds * 10) / 10,
      },
    });
    return true;
  }, [videoRef]);

  return { trackNavigation, getBehaviorContext, recordQuestion };
}
