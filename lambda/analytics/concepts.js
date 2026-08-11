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

export function conceptsForLesson(lessonSlug) {
  return [...(LESSON_CONCEPTS.get(lessonSlug) || [])];
}

export function evidenceFromEvent(event) {
  const concept = conceptAt(event?.lessonSlug, event?.videoTime);

  if (event?.eventName === 'question_asked') {
    if (event.properties?.isRepeated === true) return null;
    const semanticConcept = conceptById(event.lessonSlug, event.properties?.semanticConceptId);
    const semanticConfidence = Number(event.properties?.semanticConfidence);
    if (semanticConcept && semanticConfidence >= 0.75) {
      return { concept: semanticConcept, signal: 'concept_question', weight: 0.5 };
    }
    return concept ? { concept, signal: 'concept_question', weight: 0.5 } : null;
  }

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

// Calibrated against the decayed, diminishing-returns score so that support
// fires at about the rate the earlier linear scale produced: two fresh
// clarification requests reach support_recommended, one reaches possible_support.
// Two fresh clarification requests score log2(3) = 1.585, so the recommended
// threshold sits just below that rather than at a rounder 1.6 that would miss it.
// Likewise two fresh rewinds score 0.79, which must still register as possible
// support the way the earlier linear scale did; one rewind alone (0.5) must not.
export const POSSIBLE_SUPPORT_SCORE = 0.75;
export const SUPPORT_RECOMMENDED_SCORE = 1.55;

export function statusForEvidence(score) {
  const value = Number(score) || 0;
  if (value >= SUPPORT_RECOMMENDED_SCORE) return 'support_recommended';
  if (value >= POSSIBLE_SUPPORT_SCORE) return 'possible_support';
  return 'no_support_inference';
}

export function buildLearnerSummary(conceptStates) {
  // Same threshold as possible_support, so a concept the chatbot personalizes on
  // can never be missing from the summary the supervisor reads.
  const ranked = [...conceptStates]
    .filter((item) => Number(item.evidenceScore) >= POSSIBLE_SUPPORT_SCORE)
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
