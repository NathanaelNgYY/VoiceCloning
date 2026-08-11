const STATUS_ORDER = Object.freeze({
  support_recommended: 2,
  possible_support: 1,
  no_support_inference: 0,
});

export const SUPPORT_THRESHOLDS = Object.freeze({ possible: 0.75, recommended: 1.55 });
const EVIDENCE_HALF_LIFE_MS = 14 * 86_400_000;

export const SIGNAL_LABELS = Object.freeze({
  concept_question: 'Concept question',
  repeated_question: 'Repeated question',
  rewatched_segment: 'Rewatched segment',
  long_pause: 'Long pause',
  reviewed_transcript: 'Reviewed transcript',
});

export function conceptStatusLabel(status) {
  if (status === 'support_recommended') return 'Support recommended';
  if (status === 'possible_support') return 'Possible support';
  return 'No support inference';
}

export function evidenceContributions(events, at = new Date()) {
  const rankedSignals = new Map();
  return [...(events || [])]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .map((event) => {
      const rank = (rankedSignals.get(event.signal) || 0) + 1;
      rankedSignals.set(event.signal, rank);
      const occurredAt = Date.parse(event.occurredAt);
      const ageMs = Number.isFinite(occurredAt) ? Math.max(0, at.getTime() - occurredAt) : Infinity;
      const decay = Number.isFinite(ageMs) ? 0.5 ** (ageMs / EVIDENCE_HALF_LIFE_MS) : 0;
      return {
        ...event,
        effectiveContribution: Number(event.weight || 0) * decay * Math.log2((rank + 1) / rank),
      };
    });
}

export function rankConcepts(lesson) {
  return [...(lesson?.concepts || [])]
    .map((concept) => ({
      ...concept,
      evidenceScore: Number(concept.evidenceScore) || 0,
      evidenceCount: Number(concept.evidenceCount) || 0,
      signals: [...new Set(concept.signals || [])],
      evidenceEvents: evidenceContributions(concept.evidenceEvents),
    }))
    .sort((left, right) => (
      (STATUS_ORDER[right.status] || 0) - (STATUS_ORDER[left.status] || 0)
      || right.evidenceScore - left.evidenceScore
      || String(left.conceptLabel).localeCompare(String(right.conceptLabel))
    ));
}

export function lessonAnalytics(lesson) {
  const concepts = rankConcepts(lesson);
  const visibleConcepts = concepts.filter((concept) => concept.status !== 'no_support_inference');
  const maxScore = Math.max(1, ...visibleConcepts.map((concept) => concept.evidenceScore));
  return {
    concepts,
    visibleConcepts,
    maxScore,
    totalEvidence: concepts.reduce((total, concept) => total + concept.evidenceCount, 0),
    needsReviewCount: concepts.filter((concept) => concept.status === 'support_recommended').length,
  };
}

