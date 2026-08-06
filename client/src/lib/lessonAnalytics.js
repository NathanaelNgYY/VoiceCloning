export const ANALYTICS_SCHEMA_VERSION = 1;
export const ANALYTICS_FLUSH_INTERVAL_MS = 10000;
export const ANALYTICS_BATCH_SIZE = 20;
export const BEHAVIOR_WINDOW_MS = 120000;
export const LONG_PAUSE_SECONDS = 15;

const ANALYTICS_ENDPOINT = '/api/analytics/events';

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function finiteSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 1000) / 1000 : null;
}

export function createLessonBehaviorState({ now = () => Date.now() } = {}) {
  const seeks = [];
  let pausedAtMs = null;

  function prune(timestampMs) {
    while (seeks.length && timestampMs - seeks[0].atMs > BEHAVIOR_WINDOW_MS) {
      seeks.shift();
    }
  }

  return {
    recordSeek(fromSeconds, toSeconds) {
      const from = finiteSeconds(fromSeconds);
      const to = finiteSeconds(toSeconds);
      if (from === null || to === null || Math.abs(to - from) < 1) return null;
      const entry = { atMs: now(), deltaSeconds: to - from };
      seeks.push(entry);
      prune(entry.atMs);
      return entry;
    },
    recordPause() {
      if (pausedAtMs === null) pausedAtMs = now();
    },
    recordResume() {
      const durationSeconds = pausedAtMs === null ? 0 : Math.max(0, (now() - pausedAtMs) / 1000);
      pausedAtMs = null;
      return Math.round(durationSeconds * 10) / 10;
    },
    getContext({ transcriptReading = false } = {}) {
      const timestampMs = now();
      prune(timestampMs);
      const backwards = seeks.filter((entry) => entry.deltaSeconds < 0);
      const forwards = seeks.filter((entry) => entry.deltaSeconds >= 30);
      const pauseDurationSeconds = pausedAtMs === null
        ? 0
        : Math.max(0, Math.round((timestampMs - pausedAtMs) / 1000));
      return {
        rewindCount: backwards.length,
        largestBackwardSeekSeconds: backwards.length
          ? Math.round(Math.max(...backwards.map((entry) => Math.abs(entry.deltaSeconds))))
          : 0,
        forwardSkipCount: forwards.length,
        pauseDurationSeconds,
        transcriptReading: Boolean(transcriptReading && pauseDurationSeconds >= LONG_PAUSE_SECONDS),
      };
    },
  };
}

export function createLessonAnalyticsClient({
  lessonSlug,
  fetchImpl = globalThis.fetch,
  getAuthToken = null,
} = {}) {
  const sessionId = createId();
  let queue = [];
  let sending = false;
  let flushTimer = null;

  async function flush({ useBeacon = false } = {}) {
    if (sending || queue.length === 0) return false;
    const events = queue.splice(0, ANALYTICS_BATCH_SIZE);
    const body = JSON.stringify({ schemaVersion: ANALYTICS_SCHEMA_VERSION, events });

    // sendBeacon cannot attach an Authorization header. It remains useful only
    // for explicitly anonymous/local builds; identified analytics uses a
    // keepalive fetch during teardown instead.
    if (
      useBeacon
      && !getAuthToken
      && typeof navigator !== 'undefined'
      && typeof navigator.sendBeacon === 'function'
    ) {
      const accepted = navigator.sendBeacon(
        ANALYTICS_ENDPOINT,
        new Blob([body], { type: 'application/json' }),
      );
      if (accepted) return true;
    }

    if (typeof fetchImpl !== 'function') {
      queue = [...events, ...queue].slice(-100);
      return false;
    }

    sending = true;
    try {
      const token = getAuthToken ? await getAuthToken() : '';
      if (getAuthToken && !token) throw new Error('Analytics token is unavailable.');
      const response = await fetchImpl(ANALYTICS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
        keepalive: true,
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`Analytics ingest returned ${response.status}`);
      return true;
    } catch {
      queue = [...events, ...queue].slice(-100);
      return false;
    } finally {
      sending = false;
    }
  }

  function scheduleFlush() {
    if (flushTimer !== null || typeof window === 'undefined') return;
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      void flush();
    }, ANALYTICS_FLUSH_INTERVAL_MS);
  }

  function track(eventName, { videoTime = null, properties = {} } = {}) {
    queue.push({
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      eventId: createId(),
      sessionId,
      occurredAt: new Date().toISOString(),
      eventName,
      lessonSlug: String(lessonSlug || '').slice(0, 80),
      ...(finiteSeconds(videoTime) === null ? {} : { videoTime: finiteSeconds(videoTime) }),
      properties,
    });
    if (queue.length >= ANALYTICS_BATCH_SIZE) void flush();
    else scheduleFlush();
  }

  return {
    sessionId,
    track,
    flush,
    close() {
      if (flushTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
      return flush({ useBeacon: true });
    },
  };
}
