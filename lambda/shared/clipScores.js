import { getObject } from './s3.js';

// Loads the per-voice audio-quality cache written at training time
// (training/datasets/<exp>/clip-scores.json) into a filename→score map.
// A missing or unreadable cache yields an empty map, which makes callers
// fall back to the filename/transcript heuristics.
export async function loadClipScores(expName, { readObject = getObject } = {}) {
  const scores = new Map();
  const normalizedExpName = String(expName || '').trim();
  if (!normalizedExpName) return scores;

  try {
    const raw = await readObject(`training/datasets/${normalizedExpName}/clip-scores.json`);
    if (!raw) return scores;
    const parsed = JSON.parse(raw.toString('utf-8'));
    for (const [filename, entry] of Object.entries(parsed)) {
      const score = Number(entry?.score);
      if (Number.isFinite(score)) scores.set(filename, score);
    }
  } catch {
    // No cache yet, or unreadable → empty map → heuristic fallback.
  }

  return scores;
}
