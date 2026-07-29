import { normalizeVoiceKey } from './chatbotVoice.js';

// The gi build pins the cloned voice it expects, so it can never silently speak
// in whatever voice happens to be activated backend-wide (the active profile is
// a single shared setting — any other build or operator can change it).
//
// This is a guard, not a selector: the browser cannot fetch an arbitrary
// profile by id. The only by-id route is /api/voice-profile/internal/:id, which
// requires a server-side secret (lambda/voice-profile/index.js:203-211), so the
// pin verifies the active profile instead of loading a different one.

/**
 * The voice key this build expects, from `?voice=` (wins, for demos) or env.
 * Empty string means "no pin" — whatever is active is accepted.
 */
export function resolvePinnedVoiceKey({ search = '', env = {} } = {}) {
  const fromUrl = new URLSearchParams(search).get('voice');
  const raw =
    fromUrl && fromUrl.trim()
      ? fromUrl
      : env.VITE_GI_VOICE_PROFILE_ID || env.VITE_CHATBOT_VOICE_PROFILE_ID || '';
  return normalizeVoiceKey(raw);
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
