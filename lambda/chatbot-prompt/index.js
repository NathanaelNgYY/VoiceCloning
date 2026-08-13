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
import { createLiveAuthGuard } from '../shared/liveAuth.js';

export const SYSTEM_PROMPT_KEY = 'chatbot-config/system-prompt.json';

// Generous, but bounded: the shipped default is ~30k characters and reference
// material gets appended client-side, so this only rejects clearly broken input.
export const MAX_PROMPT_CHARS = 200_000;

function isMissingObject(error) {
  const name = error?.name || error?.Code || '';
  return name === 'NoSuchKey' || name === 'NotFound' || error?.$metadata?.httpStatusCode === 404;
}

export const DEPLOY_KEY_HEADER = 'x-vcs-deploy-key';

export function readDeployKey(event) {
  const headers = event?.headers || {};
  const name = Object.keys(headers).find((key) => key.toLowerCase() === DEPLOY_KEY_HEADER);
  return name ? String(headers[name] || '').trim() : '';
}

export function createHandler({
  readObject = getObject,
  writeObject = uploadBuffer,
  authGuard = createLiveAuthGuard(),
  deployKey = (process.env.CHATBOT_PROMPT_DEPLOY_KEY || '').trim(),
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
          updatedAt: stored.updatedAt || '',
          updatedBy: stored.updatedBy || '',
        }, {}, event);
      } catch (error) {
        if (isMissingObject(error)) {
          // Nothing deployed yet — the frontend falls back to its built-in default.
          return ok({ prompt: '', updatedAt: '', updatedBy: '' }, {}, event);
        }
        console.error('[chatbot-prompt] read failed', error);
        return err(500, 'Could not read the deployed instructions.', event);
      }
    }

    if (method !== 'PUT') {
      return err(405, 'Method not allowed', event);
    }

    // A write changes what every student sees, so it is never anonymous when
    // authentication is configured.
    //
    // Two ways in, because the two kiosk distributions differ: the GI build signs
    // users in with Entra, while the text-chat build ships no sign-in at all and
    // can only present the shared deploy key.
    let updatedBy = '';
    if (deployKey && readDeployKey(event) === deployKey) {
      updatedBy = 'deploy-key';
    } else if (authGuard) {
      try {
        const claims = await authGuard.authorize(event);
        updatedBy = claims?.email || claims?.oid || '';
      } catch {
        return err(401, 'Sign in or enter the deploy key to publish assistant instructions.', event);
      }
    }

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

    const record = { schemaVersion: 1, prompt, updatedAt: now(), updatedBy };
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

    return ok({ updatedAt: record.updatedAt, updatedBy: record.updatedBy }, {}, event);
  };
}

export const handler = createHandler();
