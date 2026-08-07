export const GI_BLEEDING_CONCEPTS = Object.freeze([
  { id: 'introduction-overview', label: 'GI bleeding overview', start: 0, end: 65.14 },
  { id: 'presentation-epidemiology', label: 'Presentation and epidemiology', start: 65.14, end: 136.92 },
  { id: 'initial-assessment-stabilization', label: 'Initial assessment and stabilization', start: 136.92, end: 163.66 },
  { id: 'investigations-risk-stratification', label: 'Investigations and risk stratification', start: 163.66, end: 187.5 },
  { id: 'upper-gi-causes-presentation', label: 'Upper GI bleeding causes and presentation', start: 187.5, end: 301.78 },
  { id: 'upper-gi-management', label: 'Upper GI bleeding management', start: 301.78, end: 355.51 },
  { id: 'endoscopy', label: 'Endoscopy timing and therapy', start: 355.51, end: 505.88 },
  { id: 'lower-gi-bleeding', label: 'Lower GI bleeding', start: 505.88, end: 624.42 },
  { id: 'key-messages', label: 'Key messages', start: 624.42, end: 673.04 },
]);

const LESSON_CONCEPTS = new Map([
  ['gi-bleeding', GI_BLEEDING_CONCEPTS],
]);
const REPEATED_QUESTION_SIMILARITY = 0.65;

export function conceptAt(lessonSlug, seconds) {
  const time = Number(seconds);
  if (!Number.isFinite(time) || time < 0) return null;
  const concepts = LESSON_CONCEPTS.get(lessonSlug) || [];
  return concepts.find((concept) => time >= concept.start && time < concept.end) || null;
}

export function conceptById(lessonSlug, conceptId) {
  return (LESSON_CONCEPTS.get(lessonSlug) || [])
    .find((concept) => concept.id === conceptId) || null;
}

export function evidenceFromEvent(event) {
  const concept = conceptAt(event?.lessonSlug, event?.videoTime);

  if (event?.eventName === 'repeated_question') {
    const semanticConcept = conceptById(event.lessonSlug, event.properties?.semanticConceptId);
    const semanticConfidence = Number(event.properties?.semanticConfidence);
    const similarity = Number(event.properties?.similarity);
    if (semanticConcept && semanticConfidence >= 0.75 && similarity >= REPEATED_QUESTION_SIMILARITY) {
      return { concept: semanticConcept, signal: 'repeated_question', weight: 1 };
    }
    const previousConcept = conceptAt(event.lessonSlug, event.properties?.previousVideoTime);
    if (concept && previousConcept?.id === concept.id && similarity >= REPEATED_QUESTION_SIMILARITY) {
      return { concept, signal: 'repeated_question', weight: 1 };
    }
    return null;
  }

  if (!concept) return null;

  if (
    event.eventName === 'video_seek'
    && (event.properties?.direction === 'backward'
      || Number(event.properties?.toSeconds) < Number(event.properties?.fromSeconds))
  ) {
    return { concept, signal: 'rewatched_segment', weight: 0.5 };
  }

  if (
    event.eventName === 'video_play'
    && Number(event.properties?.pauseDurationSeconds) >= 15
  ) {
    return null;
  }

  if (event.eventName === 'transcript_scrolled') {
    return null;
  }

  return null;
}

export function statusForEvidence(score) {
  const value = Number(score) || 0;
  if (value >= 2) return 'support_recommended';
  if (value >= 1) return 'possible_support';
  return 'no_support_inference';
}

export function buildLearnerSummary(conceptStates) {
  const ranked = [...conceptStates]
    .filter((item) => Number(item.evidenceScore) >= 1)
    .sort((left, right) => Number(right.evidenceScore) - Number(left.evidenceScore));
  if (ranked.length === 0) {
    return {
      summary: 'There are no recent behaviour signals strong enough to suggest additional concept support.',
      focusConcepts: [],
    };
  }

  const focus = ranked.slice(0, 3);
  return {
    summary: `Recent behaviour suggests gently offering additional support for ${focus.map((item) => item.conceptLabel).join(', ')}. Do not claim that the learner is uncertain or lacks knowledge.`,
    focusConcepts: focus.map((item) => item.conceptId),
  };
}
