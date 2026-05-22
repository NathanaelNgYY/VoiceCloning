import { getObject, headObject } from './s3.js';
import { ensureProfileModelsLoaded } from './modelSelection.js';

const ACTIVE_PROFILE_KEY = 'voice-profiles/active.json';

export class VoiceProfileResolutionError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'VoiceProfileResolutionError';
    this.statusCode = statusCode;
  }
}

function getProfileStorageKey(voiceProfileId) {
  return `voice-profiles/${voiceProfileId}.json`;
}

function hasValue(value) {
  return String(value || '').trim() !== '';
}

function normalizeLanguage(value, fallback = 'en') {
  return String(value || fallback).trim().toLowerCase() || fallback;
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

function normalizeStoredProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const promptLang = normalizeLanguage(profile.prompt_lang, 'en');
  return {
    ...profile,
    prompt_lang: promptLang,
    text_lang: normalizeLanguage(profile.text_lang, promptLang),
    aux_ref_audio_paths: Array.isArray(profile.aux_ref_audio_paths)
      ? profile.aux_ref_audio_paths.filter((item) => hasValue(item))
      : [],
    defaults: normalizeDefaults(profile.defaults),
  };
}

async function defaultReadObject(key) {
  const existing = await headObject(key);
  if (!existing) return null;
  return getObject(key);
}

function mergeSynthesisBody(body, profile) {
  const defaults = profile.defaults || {};
  return {
    ...body,
    voiceProfileId: String(body.voiceProfileId || '').trim() || profile.voiceProfileId,
    ref_audio_path: profile.ref_audio_path,
    prompt_text: profile.prompt_text || '',
    prompt_lang: profile.prompt_lang || 'en',
    text_lang: body.text_lang || profile.text_lang || profile.prompt_lang || 'en',
    aux_ref_audio_paths: profile.aux_ref_audio_paths || [],
    ...(body.top_k !== undefined ? { top_k: body.top_k } : defaults.top_k !== undefined ? { top_k: defaults.top_k } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : defaults.top_p !== undefined ? { top_p: defaults.top_p } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : defaults.temperature !== undefined ? { temperature: defaults.temperature } : {}),
    ...(body.repetition_penalty !== undefined
      ? { repetition_penalty: body.repetition_penalty }
      : defaults.repetition_penalty !== undefined
        ? { repetition_penalty: defaults.repetition_penalty }
        : {}),
    ...(body.speed_factor !== undefined ? { speed_factor: body.speed_factor } : defaults.speed_factor !== undefined ? { speed_factor: defaults.speed_factor } : {}),
  };
}

export function createVoiceProfileResolver({
  readObject = defaultReadObject,
  ensureModelsLoaded = ensureProfileModelsLoaded,
} = {}) {
  return async function resolveVoiceProfile(body = {}) {
    const voiceProfileId = String(body.voiceProfileId || '').trim();
    const needsSavedProfile = Boolean(voiceProfileId || !body.ref_audio_path);

    if (!needsSavedProfile) {
      return body;
    }

    const storageKey = voiceProfileId ? getProfileStorageKey(voiceProfileId) : ACTIVE_PROFILE_KEY;
    const rawProfile = await readObject(storageKey);
    if (!rawProfile) {
      if (voiceProfileId) {
        throw new VoiceProfileResolutionError(404, `Voice profile ${voiceProfileId} not found`);
      }
      throw new VoiceProfileResolutionError(404, 'No active voice profile has been saved');
    }

    const profile = normalizeStoredProfile(JSON.parse(rawProfile.toString('utf-8')));
    await ensureModelsLoaded(profile);
    return mergeSynthesisBody(body, profile);
  };
}
