// Turns a lesson's timestamped transcript into a system-prompt section, so the
// chatbot can answer questions anchored to a moment in the video ("at 8:30,
// what does she mean?") instead of only answering general GI-bleeding questions.
//
// Two formatting constraints come from the gateway, which flattens the prompt
// with /\s+/g -> ' ' before sending it as session instructions
// (live-gateway/src/services/openaiRealtimeEvents.js:59):
//   1. Newlines do not survive, so every entry starts with a bracketed timestamp
//      that still delimits it once the whole block is one long line.
//   2. Length matters — the block is capped so a long lecture cannot crowd out
//      the teaching prompt that precedes it.
export const MAX_LESSON_CONTEXT_CHARS = 60000;

// How often the browser reports the video's position while a conversation is
// open, and how far the video must have moved for a report to be worth sending.
// The gateway only turns these reports into a note when the student starts
// speaking, so this cadence just has to be finer than a student's reaction time.
export const VIDEO_POSITION_SYNC_INTERVAL_MS = 3000;
export const VIDEO_POSITION_MIN_DELTA_SECONDS = 2;

// Lets the live-position half be switched off from the frontend build alone,
// without touching the gateway on EC2. Defaults on; set the env var to 'false'
// or '0' to fall back to timestamp-only answers.
export function isVideoPositionSharingEnabled(env = {}) {
  const raw = String(env?.VITE_GI_VIDEO_POSITION ?? '').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

/**
 * Should this position reading be sent, given the last one that was?
 * Suppresses the steady stream of near-identical readings from a playing video
 * while still letting a pause, a resume, or a seek through immediately.
 */
export function shouldSendVideoPosition(next, last) {
  if (!next || !Number.isFinite(Number(next.seconds))) return false;
  if (!last || !Number.isFinite(Number(last.seconds))) return true;
  if (Boolean(next.paused) !== Boolean(last.paused)) return true;
  if (JSON.stringify(next.behavior || {}) !== JSON.stringify(last.behavior || {})) return true;
  return Math.abs(Number(next.seconds) - Number(last.seconds)) >= VIDEO_POSITION_MIN_DELTA_SECONDS;
}

export function formatLessonTimestamp(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

// "11 minutes and 13 seconds" — the model is told to speak durations naturally,
// and giving it a spoken-form length keeps it from reading "11:13" as a clock time.
export function describeSpokenDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const minutePart = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (remainder === 0) return minutePart;
  return `${minutePart} and ${remainder} second${remainder === 1 ? '' : 's'}`;
}

function cleanLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// The video's own duration is not in the course payload; the last segment's end
// is the closest honest stand-in, and it is what the transcript actually covers.
export function resolveLessonEndSeconds(course) {
  const segments = Array.isArray(course?.transcriptSegments) ? course.transcriptSegments : [];
  const topics = Array.isArray(course?.topics) ? course.topics : [];
  const times = [
    ...segments.map((segment) => Number(segment?.endTime ?? segment?.time)),
    ...topics.map((topic) => Number(topic?.time)),
  ].filter((value) => Number.isFinite(value));
  return times.length === 0 ? 0 : Math.max(...times);
}

function buildOutline(topics) {
  return topics
    .filter((topic) => cleanLine(topic?.label))
    .map((topic) => `[${formatLessonTimestamp(topic.time)}] ${cleanLine(topic.label)}`)
    .join('\n');
}

function buildTranscript(segments) {
  return segments
    .filter((segment) => cleanLine(segment?.text))
    .map((segment) => {
      const start = formatLessonTimestamp(segment.time);
      const end = Number.isFinite(Number(segment?.endTime))
        ? formatLessonTimestamp(segment.endTime)
        : '';
      const range = end ? `${start} to ${end}` : start;
      const title = cleanLine(segment?.title);
      const heading = title ? `${title} — ` : '';
      return `[${range}] ${heading}${cleanLine(segment.text)}`;
    })
    .join('\n');
}

function buildRules(endLabel, spokenLength) {
  return [
    'The student is watching this video while talking to you, so they will ask about specific moments in it.',
    'Every entry below is tagged with the time it starts and ends, written as minutes and seconds.',
    'When the student names a time — "at 8:30", "around five minutes in", "the bit just after ten minutes" — find the entry whose range covers that time and teach what it covers. Check the entry before and after too when the time lands near a boundary.',
    'Say times the way a person would say them out loud, like "around eight thirty" or "about halfway through". Never spell out the punctuation of a timestamp.',
    'Never read the transcript back word for word. Explain what that part of the video means, in your own words, in the teaching style described above.',
    `The video is about ${spokenLength} long and ends at ${endLabel}. If the student names a time past the end, tell them the video ends before that and ask which part they meant.`,
    'You may receive notes during the conversation saying where the student\'s video player has reached. When the student says "this part", "here", or "what she just said" without naming a time, answer about the point in the most recent note. If no note has arrived, ask them which timestamp they mean instead of guessing.',
    'If the student asks about something the video never covers, say the video does not cover it, then answer from the approved teaching material above if the question is still about GI bleeding.',
    'Do not mention this transcript, the section outline, or that you were given the video text. Speak as though you know the lecture.',
  ]
    .map((rule) => `- ${rule}`)
    .join('\n');
}

/**
 * Build the lesson-video section of the system prompt.
 *
 * @param {object|null} course A course payload from the courses API.
 * @param {{ maxChars?: number }} [options]
 * @returns {string} The prompt section, or '' when the course has no transcript.
 */
export function buildLessonVideoContext(course, { maxChars = MAX_LESSON_CONTEXT_CHARS } = {}) {
  const segments = Array.isArray(course?.transcriptSegments) ? course.transcriptSegments : [];
  const topics = Array.isArray(course?.topics) ? course.topics : [];
  const transcript = buildTranscript(segments);
  if (!transcript) return '';

  const title = cleanLine(course?.title) || 'this lesson';
  const description = cleanLine(course?.description);
  const endSeconds = resolveLessonEndSeconds(course);
  const outline = buildOutline(topics);

  const block = [
    '# Lesson Video',
    `The student is watching a lecture video titled "${title}".`,
    ...(description ? [description] : []),
    'Treat everything below as approved teaching material for this lesson, on the same footing as the material above. Do not invent anything that is not in it.',
    '',
    '## Answering questions about the video',
    buildRules(formatLessonTimestamp(endSeconds), describeSpokenDuration(endSeconds)),
    ...(outline ? ['', '## Section outline', outline] : []),
    '',
    '## Timestamped transcript',
    transcript,
  ].join('\n');

  return block.length <= maxChars ? block : block.slice(0, maxChars);
}
