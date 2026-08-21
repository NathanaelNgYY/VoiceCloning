import { getObject } from './s3.js';

// Loads the per-voice audio-quality cache written at training time
// (training/datasets/<exp>/clip-scores.json) into a filename→score map.
// A missing or unreadable cache yields an empty map, which makes callers
// fall back to the filename/transcript heuristics.
export async function loadClipQualityMetrics(expName, { readObject = getObject } = {}) {
  const metrics = new Map();
  const normalizedExpName = String(expName || '').trim();
  if (!normalizedExpName) return metrics;

  try {
    const raw = await readObject(`training/datasets/${normalizedExpName}/clip-scores.json`);
    if (!raw) return metrics;
    const parsed = JSON.parse(raw.toString('utf-8'));
    for (const [filename, entry] of Object.entries(parsed)) {
      const score = Number(entry?.score);
      if (Number.isFinite(score)) metrics.set(filename, { ...entry, score });
    }
  } catch {
    // No cache yet, or unreadable → empty map → heuristic fallback.
  }

  return metrics;
}

export async function loadClipScores(expName, options = {}) {
  const metrics = await loadClipQualityMetrics(expName, options);
  return new Map([...metrics].map(([filename, entry]) => [filename, entry.score]));
}
