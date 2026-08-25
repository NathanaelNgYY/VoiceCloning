import { normalizeVoiceKey } from './chatbotVoice.js';

// The gi build pins the cloned voice it expects, so it can never silently speak
// in whatever voice happens to be activated backend-wide (the active profile is
// a single shared setting — any other build or operator can change it).
//
// GI loads this saved profile through the SSO-protected pinned-profile route.
// It does not read or mutate the backend-wide active profile, which other tools
// may change at any time.

/**
 * The exact saved profile this build expects. A configured env pin always wins;
 * GI must not silently change voice through a query string.
 * Empty string means "no pin" — whatever is active is accepted.
 */
export function resolvePinnedVoiceProfileId({ search = '', env = {} } = {}) {
  const fromUrl = new URLSearchParams(search).get('voice');
  return String(
    env.VITE_GI_VOICE_PROFILE_ID
    || env.VITE_CHATBOT_VOICE_PROFILE_ID
    || (fromUrl && fromUrl.trim() ? fromUrl : '')
  ).trim();
}

export function resolvePinnedVoiceKey(options = {}) {
  return normalizeVoiceKey(resolvePinnedVoiceProfileId(options));
}

/**
 * Whether the loaded active profile is the pinned one.
 *
 * Matches on either displayName ("DeanVoice") or voiceProfileId
 * ("deanvoice-v1") so the pin can be written either way.
 */
export function matchesPinnedVoice(profile, pinnedKey) {
  if (!pinnedKey) return true;
  if (!profile) return false;
  return [profile.displayName, profile.voiceProfileId].some(
    (candidate) => normalizeVoiceKey(candidate) === pinnedKey
  );
}

/**
 * A human-readable name for whichever voice is in force.
 *
 * A stock voice's id is an opaque ElevenLabs handle, so normalising it the way a
 * cloned voice's name is normalised produces gibberish
 * ("elevenlabsxb7hh8msujpsbsdyk0k2"). The lecture site has no voice catalogue to
 * look the real name up in, so it says what the voice *is* instead.
 */
export function describePinnedVoice(voiceProfileId) {
  const id = String(voiceProfileId || '').trim();
  if (!id) return '';
  if (id.toLowerCase().startsWith('elevenlabs:')) return 'standard voice';
  return normalizeVoiceKey(id);
}
