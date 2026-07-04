export const LIVE_TEXT_LANG = 'en';
export const LIVE_REPLY_MODES = {
  full: 'full',
  phrases: 'phrases',
};

export function createLiveSynthesisSnapshot({
  engine = 'fast',
  refParams = null,
  fullRefParams = null,
  voiceProfileId = '',
} = {}) {
  const activeEngine = engine === 'full' ? 'full' : 'fast';
  const activeRefParams = activeEngine === 'full' ? (fullRefParams || refParams) : refParams;
  return {
    engine: activeEngine,
    refParams: activeEngine === 'full' && activeRefParams
      ? {
          ...activeRefParams,
          ...(voiceProfileId ? { voiceProfileId } : {}),
        }
      : activeRefParams,
  };
}

export const LIVE_LANGUAGES = {
  en: 'en',
  zh: 'zh',
};
export const LIVE_LANGUAGE_OPTIONS = [
  { value: LIVE_LANGUAGES.en, label: 'English', replyLabel: 'English replies' },
  { value: LIVE_LANGUAGES.zh, label: 'Chinese', replyLabel: 'Chinese replies' },
];

export function normalizeLiveLanguage(language) {
  return language === LIVE_LANGUAGES.zh ? LIVE_LANGUAGES.zh : LIVE_LANGUAGES.en;
}

export function getLiveLanguageConfig(language) {
  const value = normalizeLiveLanguage(language);
  return LIVE_LANGUAGE_OPTIONS.find((option) => option.value === value) || LIVE_LANGUAGE_OPTIONS[0];
}

export function getLiveTtsLanguage(language) {
  return normalizeLiveLanguage(language) === LIVE_LANGUAGES.zh ? 'all_zh' : LIVE_LANGUAGES.en;
}

const ENGLISH_NUMBER_WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const ENGLISH_TENS_WORDS = new Set([
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
]);
const ENGLISH_ONES_WORDS = new Set([
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
]);
const ENGLISH_NUMBER_WORD_RE =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s]+(?:one|two|three|four|five|six|seven|eight|nine))?\b/gi;
const LATIN_WORD_RE = /\p{Script=Latin}+(?:[-'’]\p{Script=Latin}+)*/gu;
const QUESTION_START_RE =
  /^(who|what|where|when|why|how|which|whose|can|could|should|would|will|do|does|did|is|are|am|was|were|have|has|had)\b/i;
const PHRASE_END_RE = /[.!?;:。！？；：]$/u;
const PHRASE_SPLIT_RE = /[^.!?;:。！？；：]+[.!?;:。！？；：]+|[^.!?;:。！？；：]+$/gu;
const DOTTED_INITIALISM_DOT = '\uE000';

export function cleanLiveText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function englishNumberWordsToDigits(match) {
  const words = match.toLowerCase().split(/[-\s]+/u).filter(Boolean);
  if (words.length === 1) {
    return String(ENGLISH_NUMBER_WORDS[words[0]]);
  }
  if (
    words.length === 2
    && ENGLISH_TENS_WORDS.has(words[0])
    && ENGLISH_ONES_WORDS.has(words[1])
  ) {
    return String(ENGLISH_NUMBER_WORDS[words[0]] + ENGLISH_NUMBER_WORDS[words[1]]);
  }
  return match;
}

function cleanChineseTtsText(text) {
  return cleanLiveText(text)
    .replace(ENGLISH_NUMBER_WORD_RE, englishNumberWordsToDigits)
    .replace(LATIN_WORD_RE, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,，.。!?！？;；:：、%])\s*/gu, '$1')
    .replace(/[,，、;；:：]+([.。!?！？])/gu, '$1')
    .replace(/([\u3400-\u9FFF])\s+([\u3400-\u9FFF])/gu, '$1$2')
    .trim();
}

export function cleanLiveTtsText(text, language = LIVE_TEXT_LANG) {
  return normalizeLiveLanguage(language) === LIVE_LANGUAGES.zh
    ? cleanChineseTtsText(text)
    : cleanLiveText(text);
}

export function isLiveInputPhase(phase) {
  return phase === 'listening' || phase === 'thinking';
}

export function shouldSendLiveMicAudio({ phase, micInputEnabled }) {
  return Boolean(micInputEnabled) && isLiveInputPhase(phase);
}

export function shouldTriggerLiveBargeIn({
  phase,
  micInputEnabled,
  rms,
  threshold = 0.04,
}) {
  return phase === 'speaking' && Boolean(micInputEnabled) && Number(rms) >= threshold;
}

export function getMicOffAction({ phase, hasPendingAudio }) {
  if (phase === 'listening' && hasPendingAudio) {
    return 'commit';
  }

  if (phase === 'listening' || phase === 'speaking') {
    return 'pause';
  }

  return 'wait';
}

function ensurePhraseEnding(text) {
  if (PHRASE_END_RE.test(text)) return text;
  return `${text}${QUESTION_START_RE.test(text) ? '?' : '.'}`;
}

function protectDottedInitialisms(text) {
  return text.replace(/\b[A-Z](?:\.[A-Z])+(?:\.)?/gu, (match, offset, input) => {
    const afterMatch = input.slice(offset + match.length);
    const terminalDotEndsSentence = match.endsWith('.') && !/^\s+[a-z]/u.test(afterMatch);
    if (!terminalDotEndsSentence) return match.replace(/\./g, DOTTED_INITIALISM_DOT);
    return `${match.slice(0, -1).replace(/\./g, DOTTED_INITIALISM_DOT)}.`;
  });
}

function restoreDottedInitialisms(text) {
  return text.replaceAll(DOTTED_INITIALISM_DOT, '.');
}

export function splitLiveReplyPhrases(text) {
  const clean = protectDottedInitialisms(cleanLiveText(text));
  if (!clean) return [];

  // Em/en dashes mark a pause but aren't sentence-enders, so GPT-SoVITS reads
  // straight through them. Break phrases at dashes first so each side becomes its
  // own synthesized clip with a real pause between (matching full-mode behavior).
  const segments = clean.split(/\s*[—–]+\s*/u).map((part) => part.trim()).filter(Boolean);
  const matches = segments.flatMap((segment) => segment.match(PHRASE_SPLIT_RE) || [segment]);
  return matches
    .map((part) => restoreDottedInitialisms(ensurePhraseEnding(part.trim())))
    .filter(Boolean);
}

const FAST_FIRST_PHRASE_MAX_CHARS = 70;
const FAST_PHRASE_MIN_CHARS = 24;
const FAST_PHRASE_MIN_WORDS = 3;
const CLAUSE_BREAK_RE = /[,;:，；：]/u;

function countWords(text) {
  return (String(text).trim().match(/\S+/gu) || []).length;
}

// Live Fast plays the first clip the moment it is ready, so a long opening phrase
// delays the very first audio. When the first phrase is long, break it at its first
// natural clause boundary so audio starts sooner. To keep the shortened first phrase
// sounding clean (GPT-SoVITS reads tiny fragments poorly), only split when BOTH halves
// stay above a minimum length/word count and land on a real clause boundary, and give
// each half proper terminal punctuation. If no boundary leaves two healthy halves, the
// phrase is returned untouched.
export function shortenFirstFastPhrase(phrases, {
  maxFirstChars = FAST_FIRST_PHRASE_MAX_CHARS,
  minChars = FAST_PHRASE_MIN_CHARS,
  minWords = FAST_PHRASE_MIN_WORDS,
} = {}) {
  if (!Array.isArray(phrases) || phrases.length === 0) return phrases;
  const first = phrases[0];
  if (!first || first.length <= maxFirstChars) return phrases;

  for (let i = 0; i < first.length; i += 1) {
    if (!CLAUSE_BREAK_RE.test(first[i])) continue;
    const head = first.slice(0, i).trim();
    const tail = first.slice(i + 1).trim();
    if (
      head.length >= minChars
      && tail.length >= minChars
      && countWords(head) >= minWords
      && countWords(tail) >= minWords
    ) {
      return [
        ensurePhraseEnding(head),
        ensurePhraseEnding(tail),
        ...phrases.slice(1),
      ];
    }
  }
  return phrases;
}

export function buildLiveReplyParams(text, refParams = {}, language = LIVE_TEXT_LANG) {
  return {
    text: cleanLiveTtsText(text, language),
    text_lang: getLiveTtsLanguage(language),
    ref_audio_path: refParams.ref_audio_path,
    prompt_text: refParams.prompt_text || '',
    prompt_lang: refParams.prompt_lang || 'en',
    aux_ref_audio_paths: refParams.aux_ref_audio_paths || [],
    ...(refParams.top_k !== undefined ? { top_k: refParams.top_k } : {}),
    ...(refParams.top_p !== undefined ? { top_p: refParams.top_p } : {}),
    ...(refParams.temperature !== undefined ? { temperature: refParams.temperature } : {}),
    ...(refParams.repetition_penalty !== undefined ? { repetition_penalty: refParams.repetition_penalty } : {}),
    ...(refParams.speed_factor !== undefined ? { speed_factor: refParams.speed_factor } : {}),
    ...(refParams.voiceProfileId ? { voiceProfileId: refParams.voiceProfileId } : {}),
  };
}

export function buildLiveSentenceParams(text, refParams = {}, language = LIVE_TEXT_LANG) {
  return buildLiveReplyParams(text, refParams, language);
}

export function createChatMessage({
  id,
  role,
  text = '',
  status = 'done',
  itemId = '',
  audioUrl = null,
  audioParts = [],
  error = null,
  createdAt = Date.now(),
}) {
  return {
    id,
    role,
    text,
    status,
    itemId,
    audioUrl,
    audioParts,
    error,
    createdAt,
  };
}

// How long a user bubble may sit in 'transcribing' before the client closes the
// turn itself. Realtime transcripts normally land within a couple of seconds of
// speech stopping; if the terminal user.text event is lost (gateway bug, WS drop,
// OpenAI never emitting transcription.completed), waiting forever leaves the
// bubble stuck and the next turn overwriting it.
export const USER_TRANSCRIPT_TIMEOUT_MS = 10000;

// The active-user-message ref may only be reused while the bubble is still
// collecting the current turn. A 'done' bubble is history — overwriting it
// destroys a previous message (a stale ref once turned a finished transcript
// into the next turn's "Transcribing...").
export function canReuseActiveUserMessage(message) {
  return Boolean(message)
    && message.role === 'user'
    && (message.status === 'listening' || message.status === 'transcribing');
}

// Terminal patch for a user bubble whose transcript never arrived: keep any
// words that already streamed in, otherwise fall back to the same generic label
// the gateway's suppressed-transcript path uses. Returns null when the bubble
// is not actually stuck.
export function resolvePendingTranscriptPatch(message) {
  if (!message || message.role !== 'user' || message.status !== 'transcribing') {
    return null;
  }
  const text = cleanLiveText(message.text);
  const hasPartialWords = text && text !== 'Transcribing...' && text !== 'Listening...';
  return {
    text: hasPartialWords ? text : 'Voice message sent.',
    status: 'done',
  };
}

export function updateMessage(messages, id, patch) {
  return messages.map((message) =>
    message.id === id ? { ...message, ...patch } : message
  );
}

export function findSelectedPlayback(messages, selectedId) {
  if (!selectedId) return null;

  for (const message of messages) {
    if (message.id === selectedId && message.audioUrl) {
      return { message, part: null, audioUrl: message.audioUrl };
    }

    const part = (message.audioParts || []).find((item) => item.id === selectedId);
    if (part?.audioUrl) {
      return { message, part, audioUrl: part.audioUrl };
    }
  }

  return null;
}

export function findNextPhrasePlayback(messages, selectedId) {
  if (!selectedId) return null;

  for (const message of messages) {
    const parts = message.audioParts || [];
    const currentIndex = parts.findIndex((part) => part.id === selectedId);
    if (currentIndex === -1) continue;

    const nextPart = parts
      .slice(currentIndex + 1)
      .find((part) => part.audioUrl && ['ready', 'played'].includes(part.status));

    return nextPart ? { message, part: nextPart, audioUrl: nextPart.audioUrl } : null;
  }

  return null;
}

// One spoken reply can arrive split across several assistant messages: OpenAI
// Realtime interrupts an in-progress response when it hears more user speech,
// then continues the answer in a new response. After the last clip of one
// message finishes, chain into the first still-unplayed ready clip of a LATER
// assistant message so the whole reply keeps reading aloud. Only 'ready'
// (never-played) parts count — replaying an old message must not cascade into
// messages that were already read out.
export function findNextReplyPlayback(messages, afterMessageId) {
  const startIndex = messages.findIndex((message) => message.id === afterMessageId);
  if (startIndex === -1) return null;

  for (const message of messages.slice(startIndex + 1)) {
    if (message.role !== 'assistant') continue;
    const part = (message.audioParts || []).find(
      (item) => item.audioUrl && item.status === 'ready'
    );
    if (part) return { message, part, audioUrl: part.audioUrl };
  }

  return null;
}

// True while any assistant reply is still producing voice clips. Playback
// end-detection uses this to stay in the 'speaking' phase when the clip that
// just finished belongs to an earlier message than the one being synthesized
// (a reply split across messages) — otherwise the phase would drop to
// 'listening' and the pending reply's audio would never auto-play. Errored and
// interrupted replies don't count: their synthesis loop has already stopped.
export function hasPendingReplyWork(messages) {
  return messages.some(
    (message) => message.role === 'assistant' && message.status === 'generating_voice'
  );
}

// Decide what to do when the reply <audio> element fails on a clip. The player
// only advances on the `ended` event, so without this a failed clip would stall
// the whole reply forever. Retry the same clip once (transient decode/network
// hiccups usually recover on a reload), then skip it so the rest of the reply
// still plays. `retryState` is caller-held ({ src, retried }); a new src always
// gets a fresh retry.
export function nextAudioErrorAction(retryState, src) {
  if (!src) {
    return { action: 'ignore', retryState };
  }
  if (retryState.src === src && retryState.retried) {
    return { action: 'skip', retryState };
  }
  return { action: 'retry', retryState: { src, retried: true } };
}

// Some OpenAI Realtime "error" events are benign races that resolve on their own
// (most often a new response requested while one is still in progress, which
// happens with rapid barge-in). Surfacing them just confuses the user, so we
// swallow these specific ones instead of showing the red error banner.
export function isBenignRealtimeError(message) {
  const text = String(message || '').toLowerCase();
  return (
    text.includes('active response in progress')
    || text.includes('already has an active response')
    || text.includes('conversation_already_has_active_response')
  );
}

// The gateway letter-spaces initialisms for TTS (e.g. "GI" -> "G I"), which
// GPT-SoVITS reads with a long drag between the lone letters ("G……I"). For the
// SPOKEN text only, rejoin known initialisms into smooth phonetic spellings so
// they read naturally. The on-screen chat keeps the clean original ("GI").
// Add more entries here as other dragged terms turn up.
const SPEECH_PRONUNCIATION_FIXES = [
  [/\bG\s+I\b/g, 'gee eye'],
];

export function fixSpeechPronunciation(text) {
  let out = String(text || '');
  for (const [pattern, replacement] of SPEECH_PRONUNCIATION_FIXES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function findFirstReplayablePart(message) {
  return (message?.audioParts || []).find((part) => part.audioUrl) || null;
}
