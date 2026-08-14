import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getFullActiveVoiceProfile } from '@/services/api.js';
import { useLiveSpeech } from '@/hooks/useLiveSpeech.js';
import { buildLiveFastRefParams, normalizeLiveFastSettings } from '@/lib/liveFastSetup';
import { resolveChatbotSystemPrompt } from '@/lib/chatbotSystemPrompt';
import {
  buildDocumentsContext,
  combineSystemPromptWithDocuments,
  resolveChatbotDocuments,
} from '@/lib/chatbotDocuments';
import { useGpuStatus } from '@/lib/gpuStatus.jsx';
import { sanitizeBackendError } from '@/lib/backendErrors';
import { APP_MODE_CONFIG } from '@/lib/appMode';
import {
  matchesPinnedVoice,
  resolvePinnedVoiceKey,
  resolvePinnedVoiceProfileId,
} from '@/lib/giVoicePin';
import { buildSavedVoiceModelSnapshot } from '@/lib/savedVoiceProfile';
import { isResponseBusy, isVoiceActive, toGiStatus } from './giChatStatus.js';
import { useDeployedChatbotPrompt } from './useDeployedChatbotPrompt.js';

// Kiosk-only engine setup for the gi skin. This is the subset of
// pages/LivePage.jsx:300-615 that a chat-only UI needs: resolve the active
// cloned-voice profile, build live-fast reference params from it, assemble the
// system prompt, and hand all of that to the shared useLiveSpeech hook.
//
// `lessonContext` is an optional prompt section describing the lesson video the
// student is watching (see lib/lessonVideoContext.js), and `getVideoPosition` an
// optional poll for where that video is right now, so the assistant can resolve
// "what does she mean here?". The standalone kiosk has no video and passes
// neither.
export function useGiChatEngine({ lessonContext = '', getVideoPosition = null } = {}) {
  const { workerReady, configured } = useGpuStatus();
  const backendQueryable = !configured || workerReady;

  const [activeProfile, setActiveProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [clearedBeforeId, setClearedBeforeId] = useState('');

  const profileRequestRef = useRef(0);
  const voicePinOptions = useMemo(() => ({
    search: typeof window === 'undefined' ? '' : window.location.search,
    env: import.meta.env,
  }), []);
  const pinnedVoiceProfileId = useMemo(
    () => resolvePinnedVoiceProfileId(voicePinOptions),
    [voicePinOptions]
  );
  const pinnedVoiceKey = useMemo(
    () => resolvePinnedVoiceKey(voicePinOptions),
    [voicePinOptions]
  );

  // System prompt + uploaded documents are read once at mount; the lecture skin
  // has no editor for them (the faculty site owns that UI). The lesson context is
  // the final reference section. useLiveSpeech snapshots this when the socket
  // opens, so a lesson that arrives after the student has already started
  // talking only takes effect on the next conversation.
  //
  // Nothing is appended around the deployed prompt here. This assembly must stay
  // byte-for-byte identical to the faculty site's (pages/LivePage.jsx), because a
  // lecturer authors and tests there and deploys to here — anything added on one
  // side only is a prompt the lecturer never saw. This is exactly how a hardcoded
  // GI bleeding scope gate used to survive every prompt anyone deployed, so a
  // custom assistant would answer normally on faculty and then refuse on lectures
  // with "I can only help with GI bleeding education and this lesson video."
  const deployedPromptLoaded = useDeployedChatbotPrompt();
  const systemPrompt = useMemo(() => {
    // No editor on this skin, so a local copy could only be stale — the deployed
    // prompt (or the bundled default) is the source of truth here.
    const prompt = resolveChatbotSystemPrompt({ allowLocalOverride: false });
    const documents = resolveChatbotDocuments();
    const withDocuments = combineSystemPromptWithDocuments(
      prompt,
      buildDocumentsContext(documents).text
    );
    const lesson = String(lessonContext || '').trim();
    return lesson ? `${withDocuments}\n\n${lesson}` : withDocuments;
  }, [lessonContext, deployedPromptLoaded]);

  const loadActiveProfile = useCallback(async () => {
    const requestId = ++profileRequestRef.current;
    try {
      const res = await getFullActiveVoiceProfile();
      if (profileRequestRef.current !== requestId) return;
      setActiveProfile(res.data || null);
      setProfileError('');
    } catch (err) {
      if (profileRequestRef.current !== requestId) return;
      if (err.response?.status === 404) {
        // No voice profile has been activated yet — the ordinary state of a
        // fresh deployment, not an error. Mirrors pages/LivePage.jsx:691-696.
        setActiveProfile(null);
        setProfileError('');
        return;
      }
      setProfileError(
        sanitizeBackendError(err.response?.data?.error || err.message || 'Could not load the voice profile.')
      );
    }
  }, [pinnedVoiceProfileId]);

  useEffect(() => {
    // A configured GI build sends its fixed voiceProfileId with every synthesis
    // request. The synthesis backend resolves that saved profile itself, so page
    // startup must not be blocked by a separate profile GET (or its auth timing).
    if (!backendQueryable || pinnedVoiceProfileId) return;
    loadActiveProfile();
  }, [backendQueryable, loadActiveProfile, pinnedVoiceProfileId]);

  // Human-readable name of the active cloned voice, for the read-only
  // indicator. getFullActiveVoiceProfile() returns the stored profile
  // payload directly (lambda/voice-profile/index.js:197), which carries
  // displayName — no separate model-list lookup needed.
  const activeVoiceLabel = pinnedVoiceProfileId
    ? pinnedVoiceKey
    : String(activeProfile?.displayName || '').trim();

  // The cloned voice this build expects. The active profile is a single shared
  // backend setting, so without a pin the gi app would speak in whatever voice
  // someone else activated last.
  // Only true once a profile has actually loaded and turned out to be the wrong
  // one — a not-yet-loaded profile must not read as a mismatch.
  const voiceMismatch = !pinnedVoiceProfileId
    && Boolean(activeProfile)
    && !matchesPinnedVoice(activeProfile, pinnedVoiceKey);

  const refParams = useMemo(() => {
    // An empty object is intentional: createLiveSynthesisSnapshot adds the
    // configured voiceProfileId, and Lambda resolves Dean's refs/settings.
    if (pinnedVoiceProfileId) return {};
    if (!activeProfile) return null;
    return buildLiveFastRefParams({
      primaryPath: activeProfile.ref_audio_path || '',
      promptText: activeProfile.prompt_text || '',
      promptLang: activeProfile.prompt_lang || 'en',
      auxRefAudios: (activeProfile.aux_ref_audio_paths || []).map((path) => ({ path })),
      settings: normalizeLiveFastSettings(activeProfile.defaults || {}),
    });
  }, [activeProfile, pinnedVoiceProfileId]);

  const fastSettings = useMemo(
    () => normalizeLiveFastSettings(activeProfile?.defaults || {}),
    [activeProfile]
  );

  const voiceModel = useMemo(
    () => buildSavedVoiceModelSnapshot(activeProfile),
    [activeProfile]
  );

  const liveSpeech = useLiveSpeech({
    refParams,
    fullRefParams: null,
    engine: APP_MODE_CONFIG.defaultLiveEngine,
    replyMode: 'phrases',
    language: activeProfile?.text_lang || 'en',
    voiceProfileId: pinnedVoiceProfileId || activeProfile?.voiceProfileId || '',
    voiceModel,
    systemPrompt,
    fastMaxChunkWords: fastSettings.maxChunkWords,
    fastMaxSentencesPerChunk: fastSettings.maxSentencesPerChunk,
    getVideoPosition,
  });

  // "New chat" clears the visible transcript without touching engine state
  // (design decision D3 — no persistence, no conversation list).
  const visibleMessages = useMemo(() => {
    if (!clearedBeforeId) return liveSpeech.messages;
    const cutoff = liveSpeech.messages.findIndex((message) => message.id === clearedBeforeId);
    return cutoff === -1 ? liveSpeech.messages : liveSpeech.messages.slice(cutoff + 1);
  }, [liveSpeech.messages, clearedBeforeId]);

  const newChat = useCallback(() => {
    const last = liveSpeech.messages[liveSpeech.messages.length - 1];
    setClearedBeforeId(last ? last.id : '');
  }, [liveSpeech.messages]);

  const toggleMute = useCallback(() => {
    if (liveSpeech.isMicInputEnabled) {
      liveSpeech.disableMicInput();
    } else {
      liveSpeech.enableMicInput();
    }
  }, [liveSpeech.isMicInputEnabled, liveSpeech.disableMicInput, liveSpeech.enableMicInput]);

  const error = liveSpeech.error || profileError;

  // True only once an activated voice profile has produced usable reference
  // params — gates the controls so a fresh deployment with no cloned voice
  // can't reach useLiveSpeech's "Go to the Inference page first" dead end
  // (gi mode has no Inference page to go to).
  const voiceReady = refParams !== null && !voiceMismatch;

  return {
    status: toGiStatus(liveSpeech.phase, { hasError: Boolean(error) }),
    messages: visibleMessages,
    error,
    voiceActive: isVoiceActive(liveSpeech.phase),
    responseBusy: isResponseBusy(liveSpeech.phase),
    connecting: !backendQueryable,
    micMuted: !liveSpeech.isMicInputEnabled,
    toggleMute,
    startConversation: liveSpeech.start,
    stopConversation: liveSpeech.stop,
    newChat,
    // Typing is the alternative to the mic, for students on a machine without
    // one. Sending from a standing start opens the conversation by itself, so
    // this stays available while idle — it is only closed off while a reply is
    // already being generated, or while the session is coming up or going down.
    sendText: liveSpeech.sendTextMessage,
    canSendText:
      voiceReady
      && backendQueryable
      && !['connecting', 'thinking', 'stopping'].includes(liveSpeech.phase),
    activeVoiceLabel,
    voiceReady,
    // The pinned voice is not the one the backend has active. Surfaced so the
    // UI can say so specifically instead of the generic "no voice set up".
    voiceMismatch,
    // Mic-permission / unsupported-browser advisories from useLiveSpeech —
    // surfaced separately from `error` so GiChatPage can render them on the
    // amber advisory channel instead of the red error channel.
    notice: voiceMismatch
      ? `This build is pinned to the "${pinnedVoiceKey}" cloned voice, but "${activeVoiceLabel}" is currently active on the backend. Activate the pinned voice profile to continue.`
      : liveSpeech.notice,
    speechApiAvailable: liveSpeech.speechApiAvailable,
    // Playback plumbing — GiChatPage drives a hidden <audio> element from these.
    phase: liveSpeech.phase,
    audioSrc: liveSpeech.audioSrc,
    selectedReplyId: liveSpeech.selectedReplyId,
    playbackReady: liveSpeech.shouldPlayAudio && Boolean(liveSpeech.audioSrc),
    onAudioEnded: liveSpeech.onAudioEnded,
    // Per-reply playback controls, mirroring pages/LivePage.jsx:3914-3948.
    // `speakingMessageId` is the reply currently reading aloud, so its bubble
    // can show "Playing" instead of the "Play voice" replay affordance.
    speakingMessageId:
      liveSpeech.phase === 'speaking' ? liveSpeech.selectedReply?.id || '' : '',
    playReply: liveSpeech.playReply,
    stopVoicePlayback: liveSpeech.stopVoicePlayback,
  };
}
