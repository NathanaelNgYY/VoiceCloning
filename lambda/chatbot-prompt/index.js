// Deployed chatbot system prompt.
//
// The instructions panel in the chatbot frontend used to be a per-browser edit:
// the text lived in localStorage and the *shipped* default was the constant
// baked into the client bundle, so changing the prompt everyone else sees meant
// editing source and rebuilding. This route is the shared copy — the panel's
// "Deploy" button PUTs here, and every chatbot frontend GETs it at startup, so
// one editor's change reaches the staging apps without a rebuild.
import { uploadBuffer, getObject } from '../shared/s3.js';
import { ok, err, preflight, parseJsonBody } from '../shared/cors.js';

export const SYSTEM_PROMPT_KEY = 'chatbot-config/system-prompt.json';

// Generous, but bounded: the shipped default is ~30k characters, so this only
// rejects clearly broken input.
export const MAX_PROMPT_CHARS = 200_000;

// The lecturer's uploaded reference documents travel with the prompt. They used
// to live in the authoring browser's localStorage, which meant a deploy silently
// dropped them: the author's own test conversation had the PDFs and every
// student's did not. Storing them here is what makes "deploy" mean the whole
// assistant, not just the textarea.
//
// The cap is the client's own MAX_DOCUMENTS_CHARS budget with headroom — the
// client truncates to 180k before the model ever sees it, so anything past this
// is a broken caller rather than an ambitious reading list.
export const MAX_DOCUMENTS_CHARS = 200_000;
export const MAX_DOCUMENTS = 50;

function normalizeDocuments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((doc) => doc && typeof doc.name === 'string' && typeof doc.text === 'string')
    .map((doc) => ({ name: doc.name, text: doc.text }));
}

function totalDocumentChars(docs) {
  return docs.reduce((sum, doc) => sum + doc.name.length + doc.text.length, 0);
}

function isMissingObject(error) {
  const name = error?.name || error?.Code || '';
  return name === 'NoSuchKey' || name === 'NotFound' || error?.$metadata?.httpStatusCode === 404;
}

export function createHandler({
  readObject = getObject,
  writeObject = uploadBuffer,
  now = () => new Date().toISOString(),
} = {}) {
  return async function handler(event) {
    const method = event.requestContext?.http?.method || 'GET';
    if (method === 'OPTIONS') {
      return preflight(event);
    }

    if (method === 'GET') {
      try {
        const body = await readObject(SYSTEM_PROMPT_KEY);
        const stored = JSON.parse(body.toString('utf-8'));
        return ok({
          prompt: typeof stored.prompt === 'string' ? stored.prompt : '',
          // schemaVersion 1 records predate uploaded documents and have no such
          // field; they read back as a prompt with no reference material.
          documents: normalizeDocuments(stored.documents),
          updatedAt: stored.updatedAt || '',
          updatedBy: stored.updatedBy || '',
        }, {}, event);
      } catch (error) {
        if (isMissingObject(error)) {
          // Nothing deployed yet — the frontend falls back to its built-in default.
          return ok({ prompt: '', documents: [], updatedAt: '', updatedBy: '' }, {}, event);
        }
        console.error('[chatbot-prompt] read failed', error);
        return err(500, 'Could not read the deployed instructions.', event);
      }
    }

    if (method !== 'PUT') {
      return err(405, 'Method not allowed', event);
    }

    // Deliberately unauthenticated. The editor lives only on the text-chat kiosk
    // build, which ships no sign-in, and the operator's decision is that anyone who
    // can reach that page may change the instructions. This is a staging-only
    // surface; do not copy this route to a production distribution as-is.
    let body;
    try {
      body = parseJsonBody(event);
    } catch {
      return err(400, 'Invalid JSON body', event);
    }

    const prompt = typeof body?.prompt === 'string' ? body.prompt : null;
    if (prompt === null || !prompt.trim()) {
      return err(400, 'prompt is required', event);
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return err(413, `prompt must be ${MAX_PROMPT_CHARS} characters or fewer`, event);
    }

    // Absent `documents` means "no reference material", not "leave what is already
    // deployed". A deploy publishes the editor's whole state, so a lecturer who
    // removes every PDF and deploys must actually see them gone on the lecture
    // site — silently preserving them would be the same class of bug as silently
    // dropping them.
    const documents = normalizeDocuments(body?.documents);
    if (documents.length > MAX_DOCUMENTS) {
      return err(413, `documents must number ${MAX_DOCUMENTS} or fewer`, event);
    }
    if (totalDocumentChars(documents) > MAX_DOCUMENTS_CHARS) {
      return err(413, `documents must total ${MAX_DOCUMENTS_CHARS} characters or fewer`, event);
    }

    const record = { schemaVersion: 2, prompt, documents, updatedAt: now() };
    try {
      await writeObject(
        SYSTEM_PROMPT_KEY,
        Buffer.from(JSON.stringify(record), 'utf-8'),
        'application/json',
      );
    } catch (error) {
      console.error('[chatbot-prompt] write failed', error);
      return err(500, 'Could not deploy the instructions.', event);
    }

    return ok({ updatedAt: record.updatedAt }, {}, event);
  };
}

export const handler = createHandler();
