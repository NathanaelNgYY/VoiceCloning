// Extension-qualified so `node --test` resolves this the same way Vite does.
import { buildDocumentsContext } from './chatbotDocuments.js';

/**
 * The one place a chatbot system prompt is assembled.
 *
 * Both frontends call this and neither adds anything around it. That rule is
 * load-bearing, not stylistic: a lecturer authors and tests on the faculty site
 * and deploys to the lecture site, so any section one side appends and the other
 * does not is a prompt the lecturer never saw running. Every prompt bug this
 * codebase has had was that drift — a hardcoded scope gate on the lecture side,
 * a mock course appended by demo mode, uploaded PDFs that reached the author's
 * own test conversation but never the students'.
 *
 * If a new section is ever needed, it goes here as a named argument so both
 * sites get it in the same order, or it does not exist.
 *
 * Sections, in order:
 *   1. the deployed (or locally edited) instructions
 *   2. the lecturer's uploaded reference documents
 *   3. the lesson context for the video being watched, when there is one
 */
export function assembleSystemPrompt({
  prompt = '',
  documents = [],
  lessonContext = '',
} = {}) {
  const sections = [
    typeof prompt === 'string' ? prompt.trim() : '',
    buildDocumentsContext(documents).text.trim(),
    String(lessonContext || '').trim(),
  ];
  return sections.filter(Boolean).join('\n\n');
}
