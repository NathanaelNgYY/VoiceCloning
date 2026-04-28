const GOOD_NAME_RE = /(^|[_\-\s])(clean|clear|best|reference|ref|neutral|steady|natural)([_\-\s]|\d|$)/i;
const RISKY_NAME_RE = /(^|[_\-\s])(noisy|noise|music|bgm|silence|silent|long|bad|test)([_\-\s]|\d|$)/i;
const GOOD_AUDIO_EXTENSIONS = new Set(['.wav', '.flac']);
const OK_AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.ogg', '.webm', '.mp4']);

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
  if (wordCount <= 24) return 36;
  if (wordCount <= 45) return 24;
  return 8;
}

function scoreReferenceClip(file) {
  const filename = file?.filename || '';
  const ext = extensionOf(filename);
  const lang = normalizeLang(file?.lang);

  let score = transcriptScore(file?.transcript);

  if (GOOD_AUDIO_EXTENSIONS.has(ext)) score += 18;
  else if (OK_AUDIO_EXTENSIONS.has(ext)) score += 6;

  if (lang === 'en' || lang === 'eng') score += 14;
  else if (lang === 'auto' || !lang) score += 3;

  if (GOOD_NAME_RE.test(filename)) score += 14;
  if (/(^|[_\-\s])(reference|ref)([_\-\s]|\d|$)/i.test(filename)) score += 8;
  if (/(^|[_\-\s])(aux|auxiliary)([_\-\s]|\d|$)/i.test(filename)) score -= 4;
  if (RISKY_NAME_RE.test(filename)) score -= 32;

  return score;
}

export function chooseBestReferenceSet(files, { maxAux = 2 } = {}) {
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

  return {
    primary,
    aux,
    reason: 'Auto-picked from transcript quality, language, file type, and clean-reference filename hints.',
  };
}
