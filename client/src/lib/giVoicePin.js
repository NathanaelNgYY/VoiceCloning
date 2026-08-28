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
 * A matching key for whichever voice is in force, for the pin-mismatch notice.
 *
 * A stock voice's id is an opaque ElevenLabs handle, so normalising it the way a
 * cloned voice's name is normalised produces gibberish
 * ("elevenlabsxb7hh8msujpsbsdyk0k2"). It says what the voice *is* instead.
 *
 * This is a *key*, not a label — it lowercases and strips separators so it can
 * be compared against a pin. Use describeVoiceForDisplay for anything a student
 * reads.
 */
export function describePinnedVoice(voiceProfileId) {
  const id = String(voiceProfileId || '').trim();
  if (!id) return '';
  if (id.toLowerCase().startsWith('elevenlabs:')) return 'standard voice';
  return normalizeVoiceKey(id);
}

/**
 * What to call a voice on screen when no published name is available.
 *
 * A cloned voice's id is a slug of the name it was trained under, so it reads as
 * a name already and is shown as-is — normalising it here would only strip the
 * separators that make it legible. A stock voice's id is an opaque ElevenLabs
 * handle that names nothing, so it is described rather than shown; the real name
 * ("Alice - Clear, Engaging Educator") lives in the published record and is what
 * callers prefer when the server could resolve it.
 */
export function describeVoiceForDisplay(voiceProfileId) {
  const id = String(voiceProfileId || '').trim();
  if (!id) return '';
  if (id.toLowerCase().startsWith('elevenlabs:')) return 'standard voice';
  return id;
}
