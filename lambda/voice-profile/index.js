import { uploadBuffer, getObject, headObject } from '../shared/s3.js';
import { ok, err, preflight, parseJsonBody } from '../shared/cors.js';
import { isSafePathSegment } from '../shared/paths.js';
import { inferencePost } from '../shared/gpuWorker.js';

const ACTIVE_PROFILE_KEY = 'voice-profiles/active.json';
const ACTIVE_PROFILE_PATH = /^\/api\/voice-profile\/active\/?$/u;
const ACTIVATE_PROFILE_PATH = /^\/api\/voice-profile\/activate\/?$/u;
const INTERNAL_PROFILE_PATH = /^\/api\/voice-profile\/internal\/([^/]+)\/?$/u;

function getProfileStorageKey(voiceProfileId) {
  return `voice-profiles/${voiceProfileId}.json`;
}

function hasValue(value) {
  return String(value || '').trim() !== '';
}

function normalizeLanguage(value, fallback = 'en') {
  return String(value || fallback).trim().toLowerCase() || fallback;
}

function normalizePreferredRoute(value) {
  return String(value || '').trim().toLowerCase() === 'full' ? 'full' : 'sentence';
}

function normalizeDefaults(defaults = {}) {
  return {
    ...(defaults.top_k !== undefined ? { top_k: defaults.top_k } : {}),
    ...(defaults.top_p !== undefined ? { top_p: defaults.top_p } : {}),
    ...(defaults.temperature !== undefined ? { temperature: defaults.temperature } : {}),
    ...(defaults.repetition_penalty !== undefined ? { repetition_penalty: defaults.repetition_penalty } : {}),
    ...(defaults.speed_factor !== undefined ? { speed_factor: defaults.speed_factor } : {}),
    ...(defaults.max_chunk_words !== undefined ? { max_chunk_words: defaults.max_chunk_words } : {}),
    ...(defaults.max_sentences_per_chunk !== undefined
      ? { max_sentences_per_chunk: defaults.max_sentences_per_chunk }
      : {}),
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeMetadata(metadata = {}) {
  if (!isPlainObject(metadata)) return {};
  const normalized = {
    ...(isPlainObject(metadata.training) ? { training: metadata.training } : {}),
    ...(isPlainObject(metadata.reference) ? { reference: metadata.reference } : {}),
    ...(isPlainObject(metadata.liveFast) ? { liveFast: metadata.liveFast } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : {};
}

function createVoiceProfileRecord(body, now) {
  const voiceProfileId = String(body.voiceProfileId || '').trim();
  const displayName = String(body.displayName || '').trim();
  const gptKey = String(body.gptKey || '').trim();
  const gptPath = String(body.gptPath || '').trim();
  const sovitsKey = String(body.sovitsKey || '').trim();
  const sovitsPath = String(body.sovitsPath || '').trim();
  const refAudioPath = String(body.ref_audio_path || '').trim();
  const promptText = String(body.prompt_text || '');
  const promptLang = normalizeLanguage(body.prompt_lang, 'en');
  const textLang = normalizeLanguage(body.text_lang, promptLang);
  const preferredRoute = normalizePreferredRoute(body.preferredRoute);

  if (!voiceProfileId) {
    throw new Error('voiceProfileId is required');
  }
  if (!isSafePathSegment(voiceProfileId)) {
    throw new Error('voiceProfileId must be a safe path segment');
  }
  if (!displayName) {
    throw new Error('displayName is required');
  }
  if (!hasValue(gptKey) && !hasValue(gptPath)) {
    throw new Error('gptKey or gptPath is required');
  }
  if (!hasValue(sovitsKey) && !hasValue(sovitsPath)) {
    throw new Error('sovitsKey or sovitsPath is required');
  }
  if (!refAudioPath) {
    throw new Error('ref_audio_path is required');
  }

  return {
    voiceProfileId,
    displayName,
    ...(gptKey ? { gptKey } : {}),
    ...(gptPath ? { gptPath } : {}),
    ...(sovitsKey ? { sovitsKey } : {}),
    ...(sovitsPath ? { sovitsPath } : {}),
    ref_audio_path: refAudioPath,
    prompt_text: promptText,
    prompt_lang: promptLang,
    text_lang: textLang,
    preferredRoute,
    aux_ref_audio_paths: Array.isArray(body.aux_ref_audio_paths)
      ? body.aux_ref_audio_paths.filter((item) => hasValue(item))
      : [],
    defaults: normalizeDefaults({
      ...(isPlainObject(body.metadata?.liveFast?.defaults) ? body.metadata.liveFast.defaults : {}),
      ...(isPlainObject(body.defaults) ? body.defaults : {}),
    }),
    ...(Object.keys(normalizeMetadata(body.metadata)).length > 0
      ? { metadata: normalizeMetadata(body.metadata) }
      : {}),
    updatedAt: now,
  };
}

export function buildVoiceProfileSummary(profile) {
  if (!profile) return null;
  return {
    voiceProfileId: profile.voiceProfileId,
    displayName: profile.displayName,
    ...(profile.activatedAt ? { activatedAt: profile.activatedAt } : {}),
  };
}

async function defaultReadObject(key) {
  const existing = await headObject(key);
  if (!existing) return null;
  return getObject(key);
}

async function parseStoredProfile(readObject, key) {
  const buffer = await readObject(key);
  if (!buffer) return null;
  const stored = JSON.parse(buffer.toString('utf-8'));
  const promptLang = normalizeLanguage(stored.prompt_lang, 'en');
  return {
    ...stored,
    ...(stored.prompt_lang !== undefined ? { prompt_lang: promptLang } : {}),
    text_lang: normalizeLanguage(stored.text_lang, promptLang),
    preferredRoute: normalizePreferredRoute(stored.preferredRoute),
    aux_ref_audio_paths: Array.isArray(stored.aux_ref_audio_paths)
      ? stored.aux_ref_audio_paths.filter((item) => hasValue(item))
      : [],
    defaults: normalizeDefaults({
      ...(isPlainObject(stored.metadata?.liveFast?.defaults) ? stored.metadata.liveFast.defaults : {}),
      ...(isPlainObject(stored.defaults) ? stored.defaults : {}),
    }),
    ...(Object.keys(normalizeMetadata(stored.metadata)).length > 0
      ? { metadata: normalizeMetadata(stored.metadata) }
      : {}),
  };
}

function getHeaderValue(headers, headerName) {
  const normalizedHeaderName = String(headerName || '').trim().toLowerCase();
  if (!normalizedHeaderName) return '';

  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key || '').trim().toLowerCase() === normalizedHeaderName) {
      return Array.isArray(value) ? String(value[0] || '') : String(value || '');
    }
  }

  return '';
}

function wantsFullActiveProfile(event) {
  const query = event?.queryStringParameters || {};
  const full = String(query.full || query.include || '').trim().toLowerCase();
  return ['1', 'true', 'full'].includes(full);
}

export function createHandler({
  readObject = defaultReadObject,
  writeObject = uploadBuffer,
  warmReferenceAudio = async (profile) => inferencePost('/ref-audio/warm', {
    ref_audio_path: profile.ref_audio_path,
    aux_ref_audio_paths: profile.aux_ref_audio_paths || [],
  }),
  now = () => new Date().toISOString(),
  internalAuthHeaderName = process.env.VOICE_PROFILE_INTERNAL_AUTH_HEADER_NAME || '',
  internalAuthHeaderValue = process.env.VOICE_PROFILE_INTERNAL_AUTH_HEADER_VALUE || '',
} = {}) {
  return async function handler(event) {
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return preflight(event);
    }

    const method = event.requestContext?.http?.method || 'GET';
    const routePath = event.rawPath || '';
    const internalMatch = routePath.match(INTERNAL_PROFILE_PATH);

    try {
      if (method === 'GET' && ACTIVE_PROFILE_PATH.test(routePath)) {
        const activeProfile = await parseStoredProfile(readObject, ACTIVE_PROFILE_KEY);
        if (!activeProfile) {
          return err(404, 'No active voice profile has been saved', event);
        }
        return ok(
          wantsFullActiveProfile(event) ? activeProfile : buildVoiceProfileSummary(activeProfile),
          {},
          event,
        );
      }

      if (method === 'GET' && internalMatch) {
        if (!hasValue(internalAuthHeaderName) || !hasValue(internalAuthHeaderValue)) {
          return err(500, 'Internal voice profile auth is not configured', event);
        }

        const providedSecret = getHeaderValue(event.headers, internalAuthHeaderName);
        if (providedSecret !== internalAuthHeaderValue) {
          return err(403, 'Forbidden', event);
        }

        const voiceProfileId = String(internalMatch[1] || '').trim();
        if (!voiceProfileId || !isSafePathSegment(voiceProfileId)) {
          return err(400, 'voiceProfileId must be a safe path segment', event);
        }

        const storedProfile = await parseStoredProfile(readObject, getProfileStorageKey(voiceProfileId));
        if (!storedProfile) {
          return err(404, `Voice profile ${voiceProfileId} not found`, event);
        }

        return ok(storedProfile, {}, event);
      }

      if (method === 'POST' && ACTIVATE_PROFILE_PATH.test(routePath)) {
        let body;
        try {
          body = parseJsonBody(event);
        } catch {
          return err(400, 'Invalid JSON body', event);
        }

        const currentTime = now();
        let record;
        try {
          record = createVoiceProfileRecord(body, currentTime);
        } catch (validationError) {
          return err(400, validationError.message, event);
        }

        const activeRecord = {
          ...record,
          activatedAt: currentTime,
        };

        await writeObject(
          getProfileStorageKey(record.voiceProfileId),
          Buffer.from(JSON.stringify(record), 'utf-8'),
          'application/json',
        );
        await writeObject(
          ACTIVE_PROFILE_KEY,
          Buffer.from(JSON.stringify(activeRecord), 'utf-8'),
          'application/json',
        );
        try {
          await warmReferenceAudio(activeRecord);
        } catch (warmError) {
          console.warn(`[voice-profile] ref-audio warm failed for ${record.voiceProfileId}: ${warmError.message}`);
        }

        return ok(buildVoiceProfileSummary(activeRecord), {}, event);
      }

      return err(404, 'Not found', event);
    } catch (error) {
      return err(500, error.message, event);
    }
  };
}

export const handler = createHandler();
