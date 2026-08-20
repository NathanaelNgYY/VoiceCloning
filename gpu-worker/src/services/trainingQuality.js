import path from 'path';

function normalizeTranscript(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
function parseManifestLine(line) {
  const parts = String(line || '').split('|');
  if (parts.length < 4) return null;
  return {
    line,
    audioPath: parts[0],
    filename: path.basename(parts[0].replace(/\\/gu, '/')),
    speaker: parts[1],
    language: parts[2],
    transcript: parts.slice(3).join('|').trim(),
  };
}

function wordsIn(transcript) {
  const normalized = normalizeTranscript(transcript);
  return normalized ? normalized.split(' ') : [];
}

function entryFor(scoreEntries, filename) {
  if (scoreEntries instanceof Map) return scoreEntries.get(filename);
  return scoreEntries?.[filename];
}

function transcriptReasons(row, quality) {
  const words = wordsIn(row.transcript);
  const reasons = [];
  if (words.length < 2) reasons.push('transcript_too_short');

  const duration = Number(quality?.duration_s);
  if (Number.isFinite(duration) && duration > 0 && words.length > 0) {
    const wordsPerSecond = words.length / duration;
    if (wordsPerSecond < 0.55) reasons.push('transcript_too_sparse_for_audio');
    if (wordsPerSecond > 5.5) reasons.push('transcript_too_dense_for_audio');
  }

  const uniqueRatio = words.length ? new Set(words).size / words.length : 0;
  if (words.length >= 6 && uniqueRatio < 0.35) reasons.push('transcript_repetition');
  return reasons;
}

export function buildFilteredTrainingManifest({
  manifestText = '',
  scoreEntries = {},
  minClips = 5,
  minDurationSeconds = 20,
} = {}) {
  const rows = String(manifestText || '')
    .split(/\r?\n/gu)
    .filter((line) => line.trim())
    .map(parseManifestLine)
    .filter(Boolean);

  const decisions = rows.map((row, index) => {
    const quality = entryFor(scoreEntries, row.filename);
    const reasons = [];
    if (!quality) reasons.push('missing_quality_metrics');
    if (quality?.eligible === false) {
      reasons.push(...(Array.isArray(quality.rejection_reasons)
        ? quality.rejection_reasons
        : ['acoustic_quality_rejected']));
    }
    reasons.push(...transcriptReasons(row, quality));
    return { ...row, index, quality, reasons: [...new Set(reasons)] };
  });

  // Exact duplicate transcripts usually mean repeated/overlapping slices. Keep
  // the acoustically strongest copy and reject the rest so duplicated speech
  // cannot dominate the fine-tune distribution.
  const byTranscript = new Map();
  for (const decision of decisions) {
    if (decision.reasons.length > 0) continue;
    const key = normalizeTranscript(decision.transcript);
    if (!key) continue;
    const previous = byTranscript.get(key);
    if (!previous) {
      byTranscript.set(key, decision);
      continue;
    }
    const previousScore = Number(previous.quality?.score) || 0;
    const currentScore = Number(decision.quality?.score) || 0;
    const rejected = currentScore > previousScore ? previous : decision;
    const retained = rejected === previous ? decision : previous;
    rejected.reasons.push('duplicate_transcript');
    byTranscript.set(key, retained);
  }

  const kept = decisions.filter((decision) => decision.reasons.length === 0);
  const rejected = decisions.filter((decision) => decision.reasons.length > 0);
  const keptDurationSeconds = kept.reduce(
    (sum, decision) => sum + (Number(decision.quality?.duration_s) || 0),
    0,
  );

  if (kept.length < minClips || keptDurationSeconds < minDurationSeconds) {
    throw new Error(
      `Training quality gate kept only ${kept.length}/${decisions.length} clips `
      + `(${keptDurationSeconds.toFixed(1)}s); need at least ${minClips} clips and `
      + `${minDurationSeconds}s of clean aligned speech.`,
    );
  }

  return {
    manifestText: `${kept.sort((a, b) => a.index - b.index).map((row) => row.line).join('\n')}\n`,
    report: {
      schemaVersion: 1,
      totalClips: decisions.length,
      keptClips: kept.length,
      rejectedClips: rejected.length,
      keptDurationSeconds: Number(keptDurationSeconds.toFixed(1)),
      rejected: rejected.map((row) => ({ filename: row.filename, reasons: row.reasons })),
    },
  };
}
