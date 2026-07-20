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
import { isResponseBusy, isVoiceActive, toGiStatus } from './giChatStatus.js';

// Kiosk-only engine setup for the gi skin. This is the subset of
// pages/LivePage.jsx:300-615 that a chat-only UI needs: resolve the active
// cloned-voice profile, build live-fast reference params from it, assemble the
// system prompt, and hand all of that to the shared useLiveSpeech hook.
export function useGiChatEngine() {
  const { workerReady, configured } = useGpuStatus();
  const backendQueryable = !configured || workerReady;

  const [activeProfile, setActiveProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [clearedBeforeId, setClearedBeforeId] = useState('');

  const profileRequestRef = useRef(0);

  // System prompt + uploaded documents are read once at mount; the gi skin has
  // no editor for them (the Dean kiosk owns that UI).
  const systemPrompt = useMemo(() => {
    const prompt = resolveChatbotSystemPrompt();
    const documents = resolveChatbotDocuments();
    return combineSystemPromptWithDocuments(prompt, buildDocumentsContext(documents).text);
  }, []);

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
  }, []);

  useEffect(() => {
    if (!backendQueryable) return;
    loadActiveProfile();
  }, [backendQueryable, loadActiveProfile]);

  // Human-readable name of the active cloned voice, for the read-only
  // indicator. getFullActiveVoiceProfile() returns the stored profile
  // payload directly (lambda/voice-profile/index.js:197), which carries
  // displayName — no separate model-list lookup needed.
  const activeVoiceLabel = String(activeProfile?.displayName || '').trim();

  const refParams = useMemo(() => {
    if (!activeProfile) return null;
    return buildLiveFastRefParams({
      primaryPath: activeProfile.ref_audio_path || '',
      promptText: activeProfile.prompt_text || '',
      promptLang: activeProfile.prompt_lang || 'en',
      auxRefAudios: (activeProfile.aux_ref_audio_paths || []).map((path) => ({ path })),
      settings: normalizeLiveFastSettings(activeProfile.defaults || {}),
    });
  }, [activeProfile]);

  const fastSettings = useMemo(
    () => normalizeLiveFastSettings(activeProfile?.defaults || {}),
    [activeProfile]
  );

  const liveSpeech = useLiveSpeech({
    refParams,
    fullRefParams: null,
    engine: APP_MODE_CONFIG.defaultLiveEngine,
    replyMode: 'phrases',
    language: activeProfile?.text_lang || 'en',
    voiceProfileId: activeProfile?.voiceProfileId || '',
    systemPrompt,
    fastMaxChunkWords: fastSettings.maxChunkWords,
    fastMaxSentencesPerChunk: fastSettings.maxSentencesPerChunk,
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
    activeVoiceLabel,
    // True only once an activated voice profile has produced usable reference
    // params — gates the mic button so a fresh deployment with no cloned
    // voice can't reach useLiveSpeech's "Go to the Inference page first"
    // dead end (gi mode has no Inference page to go to).
    voiceReady: refParams !== null,
    // Mic-permission / unsupported-browser advisories from useLiveSpeech —
    // surfaced separately from `error` so GiChatPage can render them on the
    // amber advisory channel instead of the red error channel.
    notice: liveSpeech.notice,
    speechApiAvailable: liveSpeech.speechApiAvailable,
    // Playback plumbing — GiChatPage drives a hidden <audio> element from these.
    phase: liveSpeech.phase,
    audioSrc: liveSpeech.audioSrc,
    selectedReplyId: liveSpeech.selectedReplyId,
    playbackReady: liveSpeech.shouldPlayAudio && Boolean(liveSpeech.audioSrc),
    onAudioEnded: liveSpeech.onAudioEnded,
  };
}
