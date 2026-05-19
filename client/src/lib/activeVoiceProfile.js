export function formatActiveVoiceProfileSummary(profile) {
  const voiceProfileId = String(profile?.voiceProfileId || '').trim();
  if (!voiceProfileId) {
    return 'No saved voice profile yet';
  }

  const displayName = String(profile?.displayName || '').trim();
  return displayName ? `${displayName} · ${voiceProfileId}` : voiceProfileId;
}
