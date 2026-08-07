const STATUS_ORDER = Object.freeze({
  needs_review: 2,
  possible_uncertainty: 1,
  insufficient_evidence: 0,
});

export const SIGNAL_LABELS = Object.freeze({
  repeated_question: 'Repeated question',
  rewatched_segment: 'Rewatched segment',
  long_pause: 'Long pause',
  reviewed_transcript: 'Reviewed transcript',
});

export function conceptStatusLabel(status) {
  if (status === 'needs_review') return 'Needs review';
  if (status === 'possible_uncertainty') return 'Possible uncertainty';
  return 'Not enough evidence';
}

export function rankConcepts(lesson) {
  return [...(lesson?.concepts || [])]
    .map((concept) => ({
      ...concept,
      evidenceScore: Number(concept.evidenceScore) || 0,
      evidenceCount: Number(concept.evidenceCount) || 0,
      signals: [...new Set(concept.signals || [])],
    }))
    .sort((left, right) => (
      (STATUS_ORDER[right.status] || 0) - (STATUS_ORDER[left.status] || 0)
      || right.evidenceScore - left.evidenceScore
      || String(left.conceptLabel).localeCompare(String(right.conceptLabel))
    ));
}

export function lessonAnalytics(lesson) {
  const concepts = rankConcepts(lesson);
  const visibleConcepts = concepts.filter((concept) => concept.status !== 'insufficient_evidence');
  const maxScore = Math.max(1, ...visibleConcepts.map((concept) => concept.evidenceScore));
  return {
    concepts,
    visibleConcepts,
    maxScore,
    totalEvidence: concepts.reduce((total, concept) => total + concept.evidenceCount, 0),
    needsReviewCount: concepts.filter((concept) => concept.status === 'needs_review').length,
  };
}

