// Deployed chatbot system prompt, per category.
//
// The instructions panel in the chatbot frontend used to be a per-browser edit:
// the text lived in localStorage and the *shipped* default was the constant
// baked into the client bundle, so changing the prompt everyone else sees meant
// editing source and rebuilding. This route is the shared copy — the panel's
// "Deploy" button PUTs here, and every chatbot frontend GETs it at startup, so
// one editor's change reaches the staging apps without a rebuild.
//
// A *category* is one assistant: one lecture's instructions and its reference
// documents. The category id is the lecture slug the lecture site already routes
// on (`/lesson/gi-bleeding` → category `gi-bleeding`), so a student's page asks
// for its own assistant with no new concept and no mapping table. Each category
// is one S3 object, which is what makes two lecturers deploying at the same time
// safe: different categories are different keys and cannot clobber each other.
//
// Prompts stay in S3 rather than moving to the DynamoDB tables added for
// sign-ins. A category carries its reference documents inline (up to 200k chars
// of prompt plus 200k of documents), which does not fit DynamoDB's 400 KB item
// limit, and the bucket is versioned — so every deploy already keeps a
// recoverable history of the one before it.
import {
  uploadBuffer,
  uploadBufferToPrefix,
  copyObjectToPrefix,
  getObject,
  listObjects,
} from '../shared/s3.js';
import { ok, err, preflight, parseJsonBody } from '../shared/cors.js';
import { createLiveAuthGuard } from '../shared/liveAuth.js';
import { isSafePathSegment } from '../shared/paths.js';
import { parseElevenLabsVoiceId, listElevenLabsVoices } from '../shared/elevenLabs.js';
import { normalizeEmail, ownsVoiceName } from '../shared/voiceIdentity.js';

// The pre-category object: one global prompt for every frontend. Still read as
// the fallback below, so the apps deployed before categories existed keep
// serving what was last deployed to them.
export const SYSTEM_PROMPT_KEY = 'chatbot-config/system-prompt.json';

export const CATEGORY_PREFIX = 'chatbot-config/system-prompt/';

// What a request with no `category` means. Also what the standalone kiosks (no
// lesson, so no slug) run.
export const DEFAULT_CATEGORY = 'default';

// Category ids land in an S3 key, so this is a path-safety boundary as much as a
// naming rule: no dots, no slashes, no escapes out of the prefix. Deliberately
// the same shape as the lecture slugs in the course data.
export const CATEGORY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

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

export function isValidCategory(value) {
  return typeof value === 'string' && CATEGORY_PATTERN.test(value);
}

export function categoryKey(category) {
  return `${CATEGORY_PREFIX}${category}.json`;
}

/** The requested category, or '' when the caller sent something unusable. */
export function readCategory(event) {
  const raw = event?.queryStringParameters?.category;
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_CATEGORY;
  const normalized = String(raw).trim().toLowerCase();
  return isValidCategory(normalized) ? normalized : '';
}

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

function isCategoriesPath(event) {
  const path = event?.rawPath || event?.requestContext?.http?.path || event?.path || '';
  return /\/categories\/?$/u.test(String(path));
}

/** The id a category object's key encodes, or '' for anything else in the prefix. */
export function categoryFromKey(key) {
  if (!String(key || '').startsWith(CATEGORY_PREFIX)) return '';
  const name = String(key).slice(CATEGORY_PREFIX.length);
  if (!name.endsWith('.json')) return '';
  const id = name.slice(0, -'.json'.length);
  return isValidCategory(id) ? id : '';
}

// The voice a published lecture speaks in. Two shapes only: a stock voice
// (`elevenlabs:<id>`), or a trained voice's saved-profile id, which lands in an
// S3 key on resolution and so is held to the same path-safety rule as a category.
export function normalizePublishedVoiceProfileId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (parseElevenLabsVoiceId(raw)) return raw;
  return isSafePathSegment(raw) ? raw : null;
}

/**
 * A human-readable name for a published voice.
 *
 * A cloned voice's id is a slug of its own name, so the lecture site can read a
 * name straight off it. A stock voice's id is an opaque ElevenLabs handle
 * ("elevenlabs:Xb7hH8MSUJpSbSDYk0k2") that no amount of normalising turns into
 * words, and the lecture site has no voice catalogue of its own to look it up
 * in. Resolving it here — the one place that already talks to ElevenLabs — is
 * what lets a lecture name the same voice the lecturer picked on the faculty
 * site ("Alice - Clear, Engaging Educator").
 *
 * Matched on the parsed voice id rather than the whole profile id, so a stored
 * id whose prefix is cased differently still finds its voice.
 *
 * Never throws, and an unresolved name is '': a name is a label, and neither a
 * voice dropped from the shortlist nor an unreachable ElevenLabs may stop a
 * lecture loading its assistant.
 */
async function resolveElevenLabsDisplayName(voiceProfileId) {
  const voiceId = parseElevenLabsVoiceId(voiceProfileId);
  if (!voiceId) return '';
  try {
    const voices = await listElevenLabsVoices();
    const match = voices.find((voice) => parseElevenLabsVoiceId(voice?.voiceProfileId) === voiceId);
    return String(match?.displayName || '').trim();
  } catch (error) {
    console.warn(`[chatbot-prompt] stock voice name lookup failed: ${error.message}`);
    return '';
  }
}

function isAdminIdentity(identity, env = process.env) {
  const requiredRole = env.SUPERVISOR_APP_ROLE || 'Supervisor';
  const allowedOids = new Set(
    String(env.SUPERVISOR_OIDS || '').split(',').map((value) => value.trim()).filter(Boolean),
  );
  return Boolean(identity?.roles?.includes(requiredRole) || allowedOids.has(identity?.oid));
}

function profileBelongsTo(profile, email) {
  const owner = normalizeEmail(profile?.ownerEmail);
  if (owner) return owner === normalizeEmail(email);
  return ownsVoiceName(email, profile?.displayName);
}

function normalizeArtifactKey(value) {
  const key = String(value || '').trim();
  if (!key || key.startsWith('/') || key.includes('\\') || /^[a-z][a-z0-9+.-]*:\/\//iu.test(key)) {
    return '';
  }
  const segments = key.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return key;
}

/** Exact S3 objects Dev needs to resolve and synthesize a staging-published cloned voice. */
export function publishedVoiceArtifactKeys(profile, voiceProfileId) {
  const profileId = String(voiceProfileId || '').trim();
  const required = [
    profile?.gptKey || profile?.gptPath,
    profile?.sovitsKey || profile?.sovitsPath,
    profile?.ref_audio_path,
  ].map(normalizeArtifactKey);
  if (!profileId || required.some((key) => !key)) return [];

  const auxiliaries = Array.isArray(profile?.aux_ref_audio_paths)
    ? profile.aux_ref_audio_paths.map(normalizeArtifactKey)
    : [];
  if (auxiliaries.some((key) => !key)) return [];
  return [...new Set([
    `voice-profiles/${profileId}.json`,
    ...required,
    ...auxiliaries,
  ])];
}

export function createHandler({
  readObject = getObject,
  writeObject = uploadBuffer,
  listStoredObjects = listObjects,
  mirrorPrefix = String(process.env.CHATBOT_PUBLISH_MIRROR_PREFIX || '').trim(),
  mirrorArtifact = copyObjectToPrefix,
  writeMirrorObject = uploadBufferToPrefix,
  authGuard = createLiveAuthGuard(),
  // Injected so tests can name a stock voice without standing up ElevenLabs.
  resolveStockVoiceName = resolveElevenLabsDisplayName,
  now = () => new Date().toISOString(),
} = {}) {
  return async function handler(event) {
    const method = event.requestContext?.http?.method || 'GET';
    if (method === 'OPTIONS') {
      return preflight(event);
    }

    if (isCategoriesPath(event)) {
      if (method !== 'GET') return err(405, 'Method not allowed', event);
      try {
        const objects = await listStoredObjects(CATEGORY_PREFIX);
        const categories = objects
          .map((object) => ({
            category: categoryFromKey(object.key),
            updatedAt: object.lastModified ? new Date(object.lastModified).toISOString() : '',
          }))
          .filter((entry) => entry.category)
          .sort((a, b) => a.category.localeCompare(b.category));
        return ok({ categories }, {}, event);
      } catch (error) {
        console.error('[chatbot-prompt] list failed', error);
        return err(500, 'Could not list the deployed categories.', event);
      }
    }

    const category = readCategory(event);
    if (!category) {
      return err(400, 'category must be lowercase letters, numbers and hyphens', event);
    }

    if (method === 'GET') {
      // A category with nothing deployed to it falls back to the pre-category
      // object rather than to nothing. During the rollout every lecture asks for
      // its own category for the first time, and answering those with an empty
      // prompt would drop every student back to the bundled default — a silent
      // downgrade of a working assistant. Once a category has been deployed to
      // even once, its own object always wins.
      let stored = null;
      for (const key of [categoryKey(category), SYSTEM_PROMPT_KEY]) {
        try {
          stored = JSON.parse((await readObject(key)).toString('utf-8'));
          break;
        } catch (error) {
          if (isMissingObject(error)) continue;
          console.error('[chatbot-prompt] read failed', error);
          return err(500, 'Could not read the deployed instructions.', event);
        }
      }

      if (!stored) {
        // Nothing deployed yet — the frontend falls back to its built-in default.
        return ok({ category, prompt: '', documents: [], voiceProfileId: '', voiceDisplayName: '', updatedAt: '', updatedBy: '' }, {}, event);
      }

      // schemaVersion 4 adds the voice. Older records have none, and read back
      // as '' — the lecture site then keeps its build-time pin, which is
      // exactly the behaviour it had before lectures could carry a voice.
      const publishedVoiceProfileId = typeof stored.voiceProfileId === 'string' ? stored.voiceProfileId : '';
      // schemaVersion 5 stores the name the lecturer picked alongside the id.
      // Records published before it carry only the id, so a stock voice's name
      // is resolved here on read — that is what names the voice on lectures
      // published earlier, without anyone having to republish them.
      const publishedVoiceDisplayName =
        (typeof stored.voiceDisplayName === 'string' ? stored.voiceDisplayName.trim() : '')
        || await resolveStockVoiceName(publishedVoiceProfileId);

      return ok({
        category,
        prompt: typeof stored.prompt === 'string' ? stored.prompt : '',
        // schemaVersion 1 records predate uploaded documents and have no such
        // field; they read back as a prompt with no reference material.
        documents: normalizeDocuments(stored.documents),
        voiceProfileId: publishedVoiceProfileId,
        voiceDisplayName: publishedVoiceDisplayName,
        updatedAt: stored.updatedAt || '',
        updatedBy: stored.updatedBy || '',
      }, {}, event);
    }

    if (method !== 'PUT') {
      return err(405, 'Method not allowed', event);
    }

    // Authenticated as of the moment a publish could carry a voice. It was
    // deliberately open before — the editor lived only on a kiosk build with no
    // sign-in — but a published voice can name a stock voice that bills per
    // character, so an open endpoint stopped being only a content-integrity
    // question and became a billing one. The faculty site signs in with Entra,
    // so the token is already there to send.
    //
    // GET stays open: the lecture site reads its assistant at startup, and
    // putting an auth dependency in front of that would trade a real risk for a
    // startup failure mode.
    if (!authGuard) return err(503, 'Publishing is not configured', event);
    let identity;
    try {
      identity = await authGuard.authorize(event);
    } catch {
      return err(401, 'Sign in to publish.', event);
    }

    let body;
    try {
      body = parseJsonBody(event);
    } catch {
      return err(400, 'Invalid JSON body', event);
    }

    const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
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

    // Either half is a publishable assistant on its own: papers with no typed
    // instructions are a valid configuration (the frontends supply their neutral
    // built-in instructions when the prompt is empty). Only a deploy that carries
    // neither is meaningless, and rejecting it stops an accidental empty publish
    // from wiping a working assistant.
    if (!prompt.trim() && documents.length === 0) {
      return err(400, 'prompt or documents is required', event);
    }

    // Absent means "this lecture pins no voice", which is a real choice: the
    // lecture site then falls back to its build-time pin. Rejected rather than
    // ignored when malformed, so a typo cannot silently publish a lecture that
    // speaks in the wrong voice.
    const voiceProfileId = normalizePublishedVoiceProfileId(body?.voiceProfileId);
    if (voiceProfileId === null) {
      return err(400, 'voiceProfileId must be a saved profile id or elevenlabs:<voiceId>', event);
    }
    let clonedVoiceProfile = null;
    if (voiceProfileId && !parseElevenLabsVoiceId(voiceProfileId)) {
      let profile;
      try {
        profile = JSON.parse((await readObject(`voice-profiles/${voiceProfileId}.json`)).toString('utf-8'));
      } catch (error) {
        if (isMissingObject(error)) {
          return err(400, `Voice profile ${voiceProfileId} does not exist`, event);
        }
        console.error('[chatbot-prompt] voice profile read failed', error);
        return err(500, 'Could not verify the selected voice.', event);
      }
      if (!isAdminIdentity(identity) && !profileBelongsTo(profile, identity?.email)) {
        return err(403, 'You can only publish a voice that belongs to you.', event);
      }
      clonedVoiceProfile = profile;
    }

    // Staging faculty is the one authoring surface. When configured, copy the
    // selected immutable voice artifacts into Dev before exposing the category
    // there. CopyObject keeps large model weights inside S3 instead of streaming
    // them through Lambda. Repeating a publish is intentionally idempotent.
    if (mirrorPrefix && clonedVoiceProfile) {
      const artifactKeys = publishedVoiceArtifactKeys(clonedVoiceProfile, voiceProfileId);
      if (artifactKeys.length === 0) {
        return err(400, 'The selected voice has incomplete or unsafe stored artifact paths.', event);
      }
      try {
        for (const key of artifactKeys) {
          await mirrorArtifact(key, mirrorPrefix);
        }
      } catch (error) {
        console.error('[chatbot-prompt] voice mirror failed', error);
        return err(500, 'Could not prepare the selected voice for the Dev lecture.', event);
      }
    }

    // Resolved server-side rather than taken from the request: the name is what
    // the lecture site renders, and the client that sends the id has no standing
    // to decide what that id is called.
    const voiceDisplayName = clonedVoiceProfile
      ? String(clonedVoiceProfile.displayName || '').trim()
      : await resolveStockVoiceName(voiceProfileId);

    // schemaVersion 5 adds `voiceDisplayName`; 4 added `voiceProfileId`; 3 added
    // `category`. Stored as well as keyed on so a raw object is self-describing
    // when read out of the bucket.
    const record = {
      schemaVersion: 5,
      category,
      prompt,
      documents,
      voiceProfileId,
      voiceDisplayName,
      updatedAt: now(),
    };
    const recordBuffer = Buffer.from(JSON.stringify(record), 'utf-8');
    try {
      await writeObject(
        categoryKey(category),
        recordBuffer,
        'application/json',
      );
    } catch (error) {
      console.error('[chatbot-prompt] write failed', error);
      return err(500, 'Could not deploy the instructions.', event);
    }
    if (mirrorPrefix) {
      try {
        await writeMirrorObject(categoryKey(category), recordBuffer, 'application/json', mirrorPrefix);
      } catch (error) {
        console.error('[chatbot-prompt] category mirror failed', error);
        return err(500, 'Staging was updated, but Dev could not be synchronized. Retry publish.', event);
      }
    }

    return ok({ category, updatedAt: record.updatedAt }, {}, event);
  };
}

export const handler = createHandler();
