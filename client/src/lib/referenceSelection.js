const GOOD_NAME_RE = /(^|[_\-\s])(clean|clear|best|reference|ref|neutral|steady|natural)([_\-\s]|\d|$)/i;
const RISKY_NAME_RE = /(^|[_\-\s])(noisy|noise|music|bgm|silence|silent|long|bad|test)([_\-\s]|\d|$)/i;
const GOOD_AUDIO_EXTENSIONS = new Set(['.wav', '.flac']);
const OK_AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.ogg', '.webm', '.mp4']);
const STRICT_MIN_DURATION_SECONDS = 3;
const STRICT_MAX_DURATION_SECONDS = 9;

// GPT-SoVITS slicer names each clip "..._<startSample>_<endSample>.<ext>" at 32 kHz,
// so we can recover the clip duration from the filename without any audio analysis.
const REF_SAMPLE_RATE_HZ = 32000;

function durationSecondsFromFilename(filename = '') {
  const match = String(filename).match(/_(\d+)_(\d+)\.[a-z0-9]+$/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return (end - start) / REF_SAMPLE_RATE_HZ;
}

// A good voice reference is ~3-9s: long enough for a stable speaker embedding,
// short enough to stay clean. Very short clips give an unstable voiceprint;
// very long ones are less reliable references.
function durationScore(filename) {
  const seconds = durationSecondsFromFilename(filename);
  if (seconds == null) return 0; // unknown length — stay neutral
  if (seconds < 2) return -24;
  if (seconds < 3) return 6;
  if (seconds <= 9) return 30;
  if (seconds <= 11) return 18;
  if (seconds <= 14) return 4;
  return -12;
}

function formatSeconds(seconds) {
  return Number(seconds).toFixed(1);
}

function extensionOf(filename = '') {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

function normalizeLang(lang = '') {
  return String(lang || '').trim().toLowerCase();
}

function transcriptScore(transcript = '') {
  const clean = String(transcript || '').replace(/\s+/g, ' ').trim();
  if (!clean) return -12;

  const wordCount = clean.split(' ').filter(Boolean).length;
  if (wordCount < 3) return 4;
  if (wordCount <= 5) return 22;
  if (wordCount <= 18) return 42;
  if (wordCount <= 24) return 36;
  if (wordCount <= 45) return 24;
  return 8;
}

function hasSentenceEnding(transcript = '') {
  return /[.!?。！？]\s*$/u.test(String(transcript || '').trim());
}

function transcriptWordCount(transcript = '') {
  const clean = String(transcript || '').replace(/\s+/g, ' ').trim();
  return clean ? clean.split(' ').filter(Boolean).length : 0;
}

function scoreBreakdown(file) {
  const filename = file?.filename || '';
  const ext = extensionOf(filename);
  const lang = normalizeLang(file?.lang);

  const breakdown = {
    transcript: transcriptScore(file?.transcript),
    fileType: 0,
    language: 0,
    filenameHints: 0,
    duration: durationScore(filename),
    sentenceEnding: hasSentenceEnding(file?.transcript) ? 10 : -18,
    speakerConsistency: 0,
  };

  if (GOOD_AUDIO_EXTENSIONS.has(ext)) breakdown.fileType += 18;
  else if (OK_AUDIO_EXTENSIONS.has(ext)) breakdown.fileType += 6;

  if (lang === 'en' || lang === 'eng') breakdown.language += 14;
  else if (lang === 'auto' || !lang) breakdown.language += 3;

  if (GOOD_NAME_RE.test(filename)) breakdown.filenameHints += 14;
  if (/(^|[_\-\s])(reference|ref)([_\-\s]|\d|$)/i.test(filename)) breakdown.filenameHints += 18;
  if (/(^|[_\-\s])(aux|auxiliary)([_\-\s]|\d|$)/i.test(filename)) breakdown.filenameHints -= 12;
  if (RISKY_NAME_RE.test(filename)) breakdown.filenameHints -= 32;

  // Until acoustic embedding/style metrics are available in clip metadata, use
  // neutral/steady/natural filename and transcript cues as a visible proxy.
  if (/(^|[_\-\s])(neutral|steady|natural)([_\-\s]|\d|$)/i.test(filename)) {
    breakdown.speakerConsistency += 12;
  }
  if (/\b(steady|neutral|natural|calm|consistent)\b/i.test(String(file?.transcript || ''))) {
    breakdown.speakerConsistency += 8;
  }

  return breakdown;
}

function sumBreakdown(breakdown) {
  return Object.values(breakdown).reduce((sum, value) => sum + value, 0);
}

function scoreReferenceClip(file) {
  return sumBreakdown(scoreBreakdown(file));
}

export function describeReferenceCandidate(file) {
  const filename = file?.filename || '';
  const durationSeconds = durationSecondsFromFilename(filename);
  const transcript = String(file?.transcript || '').replace(/\s+/g, ' ').trim();
  const wordCount = transcriptWordCount(transcript);
  const ext = extensionOf(filename);
  const breakdown = scoreBreakdown(file);
  const checks = {
    hasPath: Boolean(file?.path),
    hasFilename: Boolean(file?.filename),
    knownDuration: durationSeconds != null,
    idealDuration: durationSeconds != null
      && durationSeconds >= STRICT_MIN_DURATION_SECONDS
      && durationSeconds <= STRICT_MAX_DURATION_SECONDS,
    singleSpeaker: file?.singleSpeaker !== false,
    clean: file?.clean !== false && !RISKY_NAME_RE.test(filename),
    stableLoudness: file?.stableLoudness !== false,
    steadyStyle: file?.steadyStyle !== false,
    hasTranscript: wordCount >= 3,
    endsWithSentence: hasSentenceEnding(transcript),
    goodAudioType: GOOD_AUDIO_EXTENSIONS.has(ext) || OK_AUDIO_EXTENSIONS.has(ext),
  };
  const reasons = [];

  if (!checks.hasPath || !checks.hasFilename) reasons.push('Clip is missing a usable file path or filename.');
  if (!checks.knownDuration) reasons.push('Duration is unknown; strict reference selection requires slicer duration in the filename.');
  else if (!checks.idealDuration) {
    reasons.push(`Duration ${formatSeconds(durationSeconds)}s is outside the strict 3-9s reference range.`);
  }
  if (!checks.hasTranscript) reasons.push('Transcript is too short for a stable reference prompt.');
  if (!checks.endsWithSentence) reasons.push('Transcript should end with sentence punctuation.');
  if (!checks.singleSpeaker) reasons.push('Clip is not marked as single-speaker.');
  if (!checks.clean) reasons.push('Filename contains risky reference hints.');
  if (!checks.stableLoudness) reasons.push('Clip is not marked as stable in loudness.');
  if (!checks.steadyStyle) reasons.push('Clip is not marked as steady in voice/tone.');
  if (!checks.goodAudioType) reasons.push('Audio file type is not preferred for reference use.');

  return {
    file,
    filename,
    path: file?.path || '',
    score: sumBreakdown(breakdown),
    breakdown,
    checks,
    reasons,
    eligible: reasons.length === 0,
    durationSeconds,
    transcriptWordCount: wordCount,
  };
}

function rankCandidateMetadata(candidates) {
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.filename.localeCompare(b.filename);
  });
}

export function chooseBestReferenceSet(files, { maxAux = 5 } = {}) {
  const candidates = Array.isArray(files)
    ? files.filter((file) => file?.path && file?.filename)
    : [];

  if (candidates.length === 0) {
    return {
      primary: null,
      aux: [],
      reason: 'No training audio clips are available.',
    };
  }

  const described = candidates.map((file) => describeReferenceCandidate(file));
  const strictRanked = rankCandidateMetadata(described.filter((candidate) => candidate.eligible));
  const useStrict = strictRanked.length > 0;
  const ranked = useStrict
    ? strictRanked
    : candidates
      .map((file) => ({ ...describeReferenceCandidate(file), score: scoreReferenceClip(file) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.file.filename.localeCompare(b.file.filename);
      });

  const primaryMetadata = ranked[0];
  const primary = primaryMetadata.file;
  const auxMetadata = ranked.slice(1, maxAux + 1);
  const aux = auxMetadata.map((entry) => entry.file);

  return {
    primary,
    aux,
    primaryMetadata,
    auxMetadata,
    candidates: strictRanked,
    rejected: described.filter((candidate) => !candidate.eligible),
    mode: useStrict ? 'strict' : 'fallback',
    reason: useStrict
      ? 'Auto-picked after hard filtering for 3-9s duration, complete sentence transcript, clean single-speaker/stable-loudness markers, and steady voice/tone, then ranked by score.'
      : 'No clips passed strict reference filtering, so auto-picked by best-effort ranking from clip length, transcript quality, language, file type, and clean-reference filename hints.',
  };
}

export function shouldAutoApplyBestReferenceSet({
  selectedSourceKey = '',
  loadedSourceKey = '',
  loading = false,
  fileCount = 0,
  lastAppliedSourceKey = '',
} = {}) {
  return Boolean(
    selectedSourceKey
      && loadedSourceKey
      && selectedSourceKey === loadedSourceKey
      && !loading
      && Number(fileCount) > 0
      && lastAppliedSourceKey !== selectedSourceKey
  );
}
