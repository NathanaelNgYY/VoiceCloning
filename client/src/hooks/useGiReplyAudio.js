import { useEffect, useRef } from 'react';

import { nextAudioErrorAction } from './liveConversation.js';

/**
 * Drives cloned-voice reply playback for a gi chat surface.
 *
 * Reply audio plays as a chain of clips that only advances on `ended`. This
 * mirrors pages/LivePage.jsx:3115-3142 exactly, including the retry-then-skip
 * recovery — without it, one clip failing to decode stalls the rest of the
 * reply and the voice silently cuts off mid-answer.
 *
 * Returns the props to spread onto a hidden <audio> element.
 */
export function useGiReplyAudio(chat) {
  const audioRef = useRef(null);
  const audioErrorStateRef = useRef({ src: '', retried: false });

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!chat.playbackReady) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      return;
    }
    if (audio.getAttribute('src') !== chat.audioSrc) {
      audio.src = chat.audioSrc;
      audio.load();
    }
    audio.play().catch(() => {});
  }, [chat.audioSrc, chat.selectedReplyId, chat.playbackReady]);

  function handleAudioError() {
    const audio = audioRef.current;
    // Ignore errors that aren't from an active reply clip — clearing the src
    // during teardown fires an error on an empty element.
    if (!audio || chat.phase !== 'speaking') return;
    const { action, retryState } = nextAudioErrorAction(audioErrorStateRef.current, chat.audioSrc);
    audioErrorStateRef.current = retryState;
    if (action === 'retry') {
      try {
        audio.load();
        audio.play().catch(() => { chat.onAudioEnded(); });
      } catch {
        chat.onAudioEnded();
      }
    } else if (action === 'skip') {
      chat.onAudioEnded();
    }
  }

  return {
    ref: audioRef,
    className: 'hidden',
    onEnded: chat.onAudioEnded,
    onError: handleAudioError,
  };
}
