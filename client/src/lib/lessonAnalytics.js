export const ANALYTICS_SCHEMA_VERSION = 1;
export const ANALYTICS_FLUSH_INTERVAL_MS = 10000;
export const ANALYTICS_BATCH_SIZE = 20;
export const BEHAVIOR_WINDOW_MS = 120000;
export const LONG_PAUSE_SECONDS = 15;
export const REPEATED_QUESTION_MIN_SECONDS = 8;
export const REPEATED_QUESTION_MAX_SECONDS = 10 * 60;
export const REPEATED_QUESTION_SIMILARITY = 0.65;
export const SEEK_GESTURE_SETTLE_MS = 1500;

const QUESTION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'can', 'could', 'do', 'does', 'for', 'how', 'i', 'in',
  'is', 'it', 'me', 'of', 'on', 'please', 'tell', 'that', 'the', 'this', 'to',
  'what', 'when', 'why', 'with', 'would', 'you',
]);

const QUESTION_CONCEPT_TERMS = Object.freeze({
  'presentation-epidemiology': ['epidemiology', 'incidence', 'prevalence', 'mortality'],
  'initial-assessment-stabilization': [
    'initial assessment', 'stabilization', 'stabilisation', 'resuscitation',
    'hemodynamic', 'haemodynamic', 'airway', 'iv access',
  ],
  'investigations-risk-stratification': [
    'risk stratification', 'glasgow blatchford', 'blatchford', 'rockall',
    'investigation', 'blood test',
  ],
  'upper-gi-causes-presentation': [
    'upper gi cause', 'upper gastrointestinal cause', 'peptic ulcer', 'varices',
    'variceal', 'hematemesis', 'haematemesis', 'melena', 'melaena',
  ],
  'upper-gi-management': [
    'proton pump inhibitor', 'ppi', 'octreotide', 'terlipressin', 'transfusion threshold',
  ],
  endoscopy: [
    'endoscopy', 'endoscopic', 'gastroscopy', 'hemostasis', 'haemostasis',
    'endoscopic clip', 'thermal therapy', 'band ligation',
  ],
  'lower-gi-bleeding': [
    'lower gi', 'lower gastrointestinal', 'hematochezia', 'haematochezia',
    'diverticular', 'colonoscopy',
  ],
  'key-messages': ['key message', 'takeaway', 'take away', 'remember from this lesson'],
});

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

export function questionTokens(value) {
  return [...new Set(String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, ' ')
    .split(/\s+/u)
    .map((token) => {
      if (token.length > 5) return token.replace(/(?:ing|ed|es)$/u, '');
      if (token.length > 4) return token.replace(/s$/u, '');
      return token;
    })
    .filter((token) => token.length >= 2 && !QUESTION_STOP_WORDS.has(token)))];
}

export function questionSimilarity(left, right) {
  const a = questionTokens(left);
  const b = questionTokens(right);
  if (a.length < 2 || b.length < 2) return 0;
  const rightTokens = new Set(b);
  const shared = a.filter((token) => rightTokens.has(token)).length;
  return Math.round((shared / Math.min(a.length, b.length)) * 1000) / 1000;
}

export function classifyQuestionConcept(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9\s]/gu, ' ');
  const ranked = Object.entries(QUESTION_CONCEPT_TERMS)
    .map(([conceptId, terms]) => ({
      conceptId,
      score: terms.reduce((total, term) => total + (normalized.includes(term) ? 1 : 0), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (ranked.length === 0 || (ranked[1] && ranked[0].score === ranked[1].score)) return null;
  const confidence = ranked[1]
    ? ranked[0].score / (ranked[0].score + ranked[1].score)
    : 1;
  if (confidence < 0.75) return null;
  return { conceptId: ranked[0].conceptId, confidence: Math.round(confidence * 1000) / 1000 };
}

export function createRepeatedQuestionTracker({
  now = () => Date.now(),
  classifyConcept = classifyQuestionConcept,
} = {}) {
  const questions = [];
  const repeatCounts = new Map();
  let nextClusterId = 1;
  return {
    record(text, videoTime) {
      const tokens = questionTokens(text);
      const seconds = finiteSeconds(videoTime);
      if (tokens.length < 2 || seconds === null) return null;
      const atMs = now();
      const classification = classifyConcept(text);
      while (questions.length && atMs - questions[0].atMs > REPEATED_QUESTION_MAX_SECONDS * 1000) {
        questions.shift();
      }
      let best = null;
      for (const previous of questions) {
        const elapsedSeconds = (atMs - previous.atMs) / 1000;
        const similarity = questionSimilarity(previous.text, text);
        if (similarity >= REPEATED_QUESTION_SIMILARITY && (!best || similarity > best.similarity)) {
          best = {
            clusterId: previous.clusterId,
            previousVideoTime: previous.videoTime,
            similarity,
            elapsedSeconds,
            semanticConceptId:
              classification?.conceptId === previous.classification?.conceptId
                ? classification.conceptId
                : '',
            semanticConfidence:
              classification?.conceptId === previous.classification?.conceptId
                ? Math.min(classification.confidence, previous.classification.confidence)
                : 0,
          };
        }
      }
      const clusterId = best?.clusterId || nextClusterId++;
      questions.push({ text: String(text), videoTime: seconds, atMs, clusterId, classification });
      if (
        !best
        || best.elapsedSeconds < REPEATED_QUESTION_MIN_SECONDS
        || (repeatCounts.get(clusterId) || 0) >= 2
      ) return null;
      repeatCounts.set(clusterId, (repeatCounts.get(clusterId) || 0) + 1);
      return best;
    },
  };
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

// Native video controls may emit several seeking/seeked pairs while one scrubber
// gesture is still in progress. Collapse that burst to its original start and
// final destination so a single rewind cannot be counted several times.
export function createSeekGestureTracker({
  onGesture,
  delayMs = SEEK_GESTURE_SETTLE_MS,
  setTimer = (callback, delay) => window.setTimeout(callback, delay),
  clearTimer = (timer) => window.clearTimeout(timer),
} = {}) {
  let startSeconds = null;
  let endSeconds = null;
  let timer = null;

  function flush() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (startSeconds !== null && endSeconds !== null) {
      onGesture?.(startSeconds, endSeconds);
    }
    startSeconds = null;
    endSeconds = null;
  }

  return {
    record(fromSeconds, toSeconds) {
      const from = finiteSeconds(fromSeconds);
      const to = finiteSeconds(toSeconds);
      if (from === null || to === null) return;
      if (startSeconds === null) startSeconds = from;
      endSeconds = to;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(flush, delayMs);
    },
    flush,
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      startSeconds = null;
      endSeconds = null;
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
          ...(token ? { 'X-VCS-Entra-Token': token } : {}),
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
