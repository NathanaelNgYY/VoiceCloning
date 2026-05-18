import { uploadBuffer, getObject, headObject } from '../shared/s3.js';
import { ok, err, preflight, parseJsonBody } from '../shared/cors.js';
import { isSafePathSegment } from '../shared/paths.js';

const ACTIVE_PROFILE_KEY = 'voice-profiles/active.json';

function getProfileStorageKey(voiceProfileId) {
  return `voice-profiles/${voiceProfileId}.json`;
}

function hasValue(value) {
  return String(value || '').trim() !== '';
}

function normalizeDefaults(defaults = {}) {
  return {
    ...(defaults.top_k !== undefined ? { top_k: defaults.top_k } : {}),
    ...(defaults.top_p !== undefined ? { top_p: defaults.top_p } : {}),
    ...(defaults.temperature !== undefined ? { temperature: defaults.temperature } : {}),
    ...(defaults.repetition_penalty !== undefined ? { repetition_penalty: defaults.repetition_penalty } : {}),
    ...(defaults.speed_factor !== undefined ? { speed_factor: defaults.speed_factor } : {}),
  };
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
  const promptLang = String(body.prompt_lang || 'en').trim() || 'en';

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
    aux_ref_audio_paths: Array.isArray(body.aux_ref_audio_paths)
      ? body.aux_ref_audio_paths.filter((item) => hasValue(item))
      : [],
    defaults: normalizeDefaults(body.defaults),
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
  return JSON.parse(buffer.toString('utf-8'));
}

export function createHandler({
  readObject = defaultReadObject,
  writeObject = uploadBuffer,
  now = () => new Date().toISOString(),
} = {}) {
  return async function handler(event) {
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return preflight(event);
    }

    const method = event.requestContext?.http?.method || 'GET';
    const routePath = event.rawPath || '';

    try {
      if (method === 'GET' && routePath.endsWith('/voice-profile/active')) {
        const activeProfile = await parseStoredProfile(readObject, ACTIVE_PROFILE_KEY);
        if (!activeProfile) {
          return err(404, 'No active voice profile has been saved', event);
        }
        return ok(buildVoiceProfileSummary(activeProfile), {}, event);
      }

      if (method === 'POST' && routePath.endsWith('/voice-profile/activate')) {
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

        return ok(buildVoiceProfileSummary(activeRecord), {}, event);
      }

      return err(404, 'Not found', event);
    } catch (error) {
      return err(500, error.message, event);
    }
  };
}

export const handler = createHandler();
