export function buildLearnerSupportGuidance(summary) {
  if (!summary || !Array.isArray(summary.concepts)) return '';
  const concepts = summary.concepts
    .filter((concept) => ['possible_support', 'support_recommended'].includes(concept.status))
    .map((concept) => ({
      id: String(concept.conceptId || '').trim(),
      label: String(concept.conceptLabel || '').trim(),
      state: String(concept.status || '').trim(),
    }))
    .filter((concept) => concept.id && concept.label);
  if (concepts.length === 0) return '';

  return [
    'PRIVATE CONCEPT-SPECIFIC SUPPORT GUIDANCE (never quote or mention tracking):',
    'First identify the concept actually asked about in the current user message.',
    'Apply a support entry only if that current question substantially concerns the same concept.',
    'The order below is not a ranking. Never redirect an unrelated answer toward another previously supported concept.',
    // The chatbot receives the concept and its support state only. Signal names,
    // scores, and event counts are analytics detail and must not reach the model.
    ...concepts.map((concept) => `- ${concept.label} [${concept.id}]: ${concept.state}`),
    'A support state means only that an additional clear explanation may be useful. It is not evidence of confusion, deficient knowledge, or mastery.',
    'Answer the current question directly. Follow the learner\'s current explanation-style request exactly; specific constraints such as preserving medical terminology override generic simplification.',
  ].join('\n');
}
