const GOOD_NAME_RE = /(^|[_\-\s])(clean|clear|best|reference|ref|neutral|steady|natural)([_\-\s]|\d|$)/i;
const RISKY_NAME_RE = /(^|[_\-\s])(noisy|noise|music|bgm|silence|silent|long|bad|test)([_\-\s]|\d|$)/i;
const GOOD_AUDIO_EXTENSIONS = new Set(['.wav', '.flac']);
const OK_AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.ogg', '.webm', '.mp4']);

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

function extensionOf(filename = '') {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

function normalizeLang(lang = '') {
  return String(lang || '').trim().toLowerCase();
}

function langScore(lang = '') {
  const normalized = normalizeLang(lang);
  if (normalized === 'en' || normalized === 'eng') return 14;
  if (normalized === 'auto' || !normalized) return 3;
  return 0;
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

function scoreReferenceClip(file) {
  const audioScore = Number(file?.qualityScore);
  if (Number.isFinite(audioScore)) {
    // Audio quality dominates; transcript + language guard so the PRIMARY
    // (whose transcript becomes prompt_text) isn't a clean clip with no text.
    return audioScore + 0.3 * (transcriptScore(file?.transcript) + langScore(file?.lang));
  }

  const filename = file?.filename || '';
  const ext = extensionOf(filename);

  let score = transcriptScore(file?.transcript);

  if (GOOD_AUDIO_EXTENSIONS.has(ext)) score += 18;
  else if (OK_AUDIO_EXTENSIONS.has(ext)) score += 6;

  score += langScore(file?.lang);

  if (GOOD_NAME_RE.test(filename)) score += 14;
  if (/(^|[_\-\s])(reference|ref)([_\-\s]|\d|$)/i.test(filename)) score += 8;
  if (/(^|[_\-\s])(aux|auxiliary)([_\-\s]|\d|$)/i.test(filename)) score -= 4;
  if (RISKY_NAME_RE.test(filename)) score -= 32;

  // Prefer clips in the ideal reference-length window over chronologically-first ones.
  score += durationScore(filename);

  return score;
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

  const ranked = candidates
    .map((file) => ({ file, score: scoreReferenceClip(file) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.file.filename.localeCompare(b.file.filename);
    });

  const primary = ranked[0].file;
  const aux = ranked.slice(1, maxAux + 1).map((entry) => entry.file);

  const usedQualityScores = ranked.some(
    (entry) => Number.isFinite(Number(entry.file?.qualityScore)),
  );
  const reason = usedQualityScores
    ? 'Auto-picked by measured audio quality (SNR, clarity, duration), with a transcript/language tie-break.'
    : 'Auto-picked from clip length (~3-9s ideal), transcript quality, language, file type, and clean-reference filename hints.';

  return { primary, aux, reason };
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
