import { buildLearnerSummary } from './concepts.js';

const RESPONSES_URL = 'https://api.openai.com/v1/responses';

function outputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

export function createSummaryGenerator({
  apiKey = process.env.LEARNER_SUMMARY_API_KEY || '',
  model = process.env.LEARNER_SUMMARY_MODEL || 'gpt-5.6-luna',
  fetchImpl = fetch,
  logger = console,
} = {}) {
  return async function generate(conceptStates) {
    const fallback = buildLearnerSummary(conceptStates);
    if (!apiKey || conceptStates.length === 0) return { ...fallback, source: 'rules' };

    const evidence = conceptStates.map((state) => ({
      conceptId: state.conceptId,
      conceptLabel: state.conceptLabel,
      status: state.status,
      evidenceScore: state.evidenceScore,
      evidenceCount: state.evidenceCount,
      signals: [...(state.signals || [])],
    }));

    try {
      const response = await fetchImpl(RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          store: false,
          reasoning: { effort: 'low' },
          input: [
            {
              role: 'system',
              content: [{
                type: 'input_text',
                text: 'Summarize uncertain learning-behaviour evidence as cautious teaching guidance. Do not diagnose, grade, identify, or claim certainty. Mention only concepts supported by the supplied evidence.',
              }],
            },
            {
              role: 'user',
              content: [{ type: 'input_text', text: JSON.stringify(evidence) }],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'learner_summary',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  summary: { type: 'string', maxLength: 600 },
                  focusConcepts: {
                    type: 'array',
                    maxItems: 3,
                    items: { type: 'string' },
                  },
                },
                required: ['summary', 'focusConcepts'],
              },
            },
          },
        }),
      });
      if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}.`);
      const parsed = JSON.parse(outputText(await response.json()));
      const allowed = new Set(evidence.map((item) => item.conceptId));
      return {
        summary: String(parsed.summary || '').slice(0, 600) || fallback.summary,
        focusConcepts: (parsed.focusConcepts || []).filter((id) => allowed.has(id)).slice(0, 3),
        source: 'llm',
        model,
      };
    } catch (error) {
      logger.warn?.('[learner-summary] LLM generation failed; using rule summary', error?.message);
      return { ...fallback, source: 'rules' };
    }
  };
}
