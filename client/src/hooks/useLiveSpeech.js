import { useEffect, useRef, useState } from 'react';
import { synthesize, synthesizeSentence } from '../services/api.js';
import { createLiveChatSocket } from '../services/liveChatSocket.js';
import {
  LIVE_REPLY_MODES,
  buildLiveSentenceParams,
  buildLiveReplyParams,
  cleanLiveText,
  createChatMessage,
  findFirstReplayablePart,
  findNextPhrasePlayback,
  findSelectedPlayback,
  getMicOffAction,
  isLiveInputPhase,
  normalizeLiveLanguage,
  splitLiveReplyPhrases,
  shouldTriggerLiveBargeIn,
  shouldSendLiveMicAudio,
  updateMessage,
} from './liveConversation.js';

const LIVE_TARGET_SAMPLE_RATE = 24000;
const MANUAL_COMMIT_SILENCE_MS = 360;
const BARGE_IN_MIN_FRAMES = 2;
const BARGE_IN_COOLDOWN_MS = 900;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetrySynthesis(err) {
  return /already|busy|conflict|409|503/i.test(err?.message || '');
}

function getRms(samples) {
  if (!samples.length) return 0;

  let sumSq = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sumSq += samples[i] * samples[i];
  }
  return Math.sqrt(sumSq / samples.length);
}

function downsampleBuffer(input, inputSampleRate, outputSampleRate) {
  if (outputSampleRate === inputSampleRate) return input;
  if (outputSampleRate > inputSampleRate) {
    throw new Error('Output sample rate must be lower than input sample rate.');
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);

  let inputOffset = 0;
  for (let i = 0; i < outputLength; i += 1) {
    const nextInputOffset = Math.round((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = inputOffset; j < nextInputOffset && j < input.length; j += 1) {
      sum += input[j];
      count += 1;
    }
    output[i] = count > 0 ? sum / count : 0;
    inputOffset = nextInputOffset;
  }

  return output;
}

function pcm16Base64(samples) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function encodeOpenAiAudioChunk(input, inputSampleRate) {
  const downsampled = downsampleBuffer(input, inputSampleRate, LIVE_TARGET_SAMPLE_RATE);
  return pcm16Base64(downsampled);
}

export function useLiveSpeech({
  refParams,
  replyMode = LIVE_REPLY_MODES.full,
  language = 'en',
} = {}) {
  const isPhraseMode = replyMode === LIVE_REPLY_MODES.phrases;
  const liveLanguage = normalizeLiveLanguage(language);
  const [phase, setPhaseState] = useState('idle');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [messages, setMessages] = useState([]);
  const [selectedReplyId, setSelectedReplyIdState] = useState('');
  const [error, setError] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [micInputEnabled, setMicInputEnabledState] = useState(false);
  const [bargeInArmed, setBargeInArmedState] = useState(false);
  const [notice, setNotice] = useState('');
  const [speechApiAvailable, setSpeechApiAvailable] = useState(
    typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext)
  );

  const phaseRef = useRef('idle');
  const socketRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const isCancelledRef = useRef(false);
  const runIdRef = useRef(0);
  const messageSeqRef = useRef(0);
  const messagesRef = useRef([]);
  const selectedReplyIdRef = useRef('');
  const micInputEnabledRef = useRef(false);
  const activeUserMessageIdRef = useRef('');
  const activeAssistantMessageIdRef = useRef('');
  const currentSynthesisMessageIdRef = useRef('');
  const cancelledReplyIdsRef = useRef(new Set());
  const userTextBuffersRef = useRef(new Map());
  const assistantTextRef = useRef('');
  const noticeTimeoutRef = useRef(null);
  const pendingInputAudioRef = useRef(false);
  const bargeInArmedRef = useRef(false);
  const bargeInFramesRef = useRef(0);
  const lastBargeInAtRef = useRef(0);

  function setPhase(phase) {
    phaseRef.current = phase;
    setPhaseState(phase);
  }

  function setSelectedReplyId(id) {
    selectedReplyIdRef.current = id;
    setSelectedReplyIdState(id);
  }

  function setMicInputEnabled(value) {
    micInputEnabledRef.current = Boolean(value);
    setMicInputEnabledState(Boolean(value));
  }

  function setBargeInArmed(value) {
    bargeInArmedRef.current = Boolean(value);
    setBargeInArmedState(Boolean(value));
  }

  function setMessagesSync(updater) {
    setMessages((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      messagesRef.current = next;
      return next;
    });
  }

  function nextMessageId(prefix) {
    messageSeqRef.current += 1;
    return `${prefix}-${Date.now()}-${messageSeqRef.current}`;
  }

  function patchMessage(id, patch) {
    setMessagesSync((prev) => updateMessage(prev, id, patch));
  }

  function patchAudioPart(messageId, partId, patch) {
    setMessagesSync((prev) =>
      prev.map((message) => {
        if (message.id !== messageId) return message;
        return {
          ...message,
          audioParts: (message.audioParts || []).map((part) =>
            part.id === partId ? { ...part, ...patch } : part
          ),
        };
      })
    );
  }

  function appendMessage(message) {
    setMessagesSync((prev) => [...prev, message]);
  }

  function showNotice(message) {
    setNotice(message);
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice('');
      noticeTimeoutRef.current = null;
    }, 3500);
  }

  function revokeMessageAudio(message) {
    if (message?.audioUrl) {
      try {
        URL.revokeObjectURL(message.audioUrl);
      } catch {
        // Ignore object URL cleanup failures.
      }
    }
    for (const part of message?.audioParts || []) {
      if (part.audioUrl) {
        try {
          URL.revokeObjectURL(part.audioUrl);
        } catch {
          // Ignore object URL cleanup failures.
        }
      }
    }
  }

  function cleanupConversation() {
    for (const message of messagesRef.current) {
      revokeMessageAudio(message);
    }
    messagesRef.current = [];
    setMessages([]);
    setSelectedReplyId('');
    activeUserMessageIdRef.current = '';
    activeAssistantMessageIdRef.current = '';
    currentSynthesisMessageIdRef.current = '';
    pendingInputAudioRef.current = false;
    setBargeInArmed(false);
    bargeInFramesRef.current = 0;
    lastBargeInAtRef.current = 0;
    cancelledReplyIdsRef.current = new Set();
    userTextBuffersRef.current = new Map();
  }

  function findUserMessageId(itemId) {
    if (itemId) {
      const existing = messagesRef.current.find(
        (message) => message.role === 'user' && message.itemId === itemId
      );
      if (existing) return existing.id;
    }
    return activeUserMessageIdRef.current;
  }

  function ensureUserMessage(itemId = '') {
    const existingId = findUserMessageId(itemId);
    if (existingId) {
      if (itemId) patchMessage(existingId, { itemId });
      return existingId;
    }

    const id = itemId ? `user-${itemId}` : nextMessageId('user');
    activeUserMessageIdRef.current = id;
    appendMessage(createChatMessage({
      id,
      role: 'user',
      itemId,
      text: 'Listening...',
      status: 'listening',
    }));
    return id;
  }

  function ensureAssistantMessage() {
    if (activeAssistantMessageIdRef.current) {
      return activeAssistantMessageIdRef.current;
    }

    const id = nextMessageId('assistant');
    activeAssistantMessageIdRef.current = id;
    appendMessage(createChatMessage({
      id,
      role: 'assistant',
      text: '',
      status: 'thinking',
    }));
    return id;
  }

  function pauseOpenAiInput() {
    socketRef.current?.send({ type: 'input.pause' });
  }

  function resumeOpenAiInput() {
    socketRef.current?.send({ type: 'input.resume' });
  }

  function commitOpenAiInput() {
    const sent = socketRef.current?.send({ type: 'input.commit' });
    if (sent) {
      pendingInputAudioRef.current = false;
    }
    return sent;
  }

  function sendManualCommitTail() {
    const sampleCount = Math.round((LIVE_TARGET_SAMPLE_RATE * MANUAL_COMMIT_SILENCE_MS) / 1000);
    sendAudioChunk(new Float32Array(sampleCount), LIVE_TARGET_SAMPLE_RATE);
  }

  function syncOpenAiInputWithMic(nextPhase = phaseRef.current) {
    if (micInputEnabledRef.current && isLiveInputPhase(nextPhase)) {
      resumeOpenAiInput();
      return;
    }
    pauseOpenAiInput();
  }

  async function synthesizeWithRetry(params) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await synthesize(params);
      } catch (err) {
        lastError = err;
        if (!shouldRetrySynthesis(err) || attempt === 2) {
          throw err;
        }
        await wait(650 * (attempt + 1));
      }
    }
    throw lastError;
  }

  async function synthesizeSentenceWithRetry(params) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await synthesizeSentence(params);
      } catch (err) {
        lastError = err;
        if (!shouldRetrySynthesis(err) || attempt === 2) {
          throw err;
        }
        await wait(650 * (attempt + 1));
      }
    }
    throw lastError;
  }

  function firstReadyPart(message, afterPartId = '') {
    const parts = message?.audioParts || [];
    const start = afterPartId
      ? Math.max(0, parts.findIndex((part) => part.id === afterPartId) + 1)
      : 0;
    return parts.slice(start).find((part) => part.status === 'ready' && part.audioUrl) || null;
  }

  function hasPendingParts(message) {
    return (message?.audioParts || []).some((part) =>
      ['queued', 'generating'].includes(part.status)
    );
  }

  async function synthesizeFullAssistantReply(messageId, text, runId) {
    if (!refParams) return;

    currentSynthesisMessageIdRef.current = messageId;
    cancelledReplyIdsRef.current.delete(messageId);
    pauseOpenAiInput();
    setSelectedReplyId(messageId);
    setPhase('speaking');
    patchMessage(messageId, { status: 'generating_voice', error: null });

    try {
      const blob = await synthesizeWithRetry(buildLiveReplyParams(text, refParams, liveLanguage));
      if (
        isCancelledRef.current ||
        runId !== runIdRef.current ||
        cancelledReplyIdsRef.current.has(messageId)
      ) {
        return;
      }

      const url = URL.createObjectURL(blob);
      patchMessage(messageId, { status: 'ready', audioUrl: url, error: null });
      setSelectedReplyId(messageId);
      setPhase('speaking');
    } catch (err) {
      if (isCancelledRef.current || runId !== runIdRef.current) return;

      patchMessage(messageId, {
        status: 'error',
        error: err.message || 'Voice generation failed',
      });
      setError(`Voice reply failed: ${err.message}`);
      const nextPhase = socketRef.current ? 'listening' : 'idle';
      setPhase(nextPhase);
      syncOpenAiInputWithMic(nextPhase);
    } finally {
      if (currentSynthesisMessageIdRef.current === messageId) {
        currentSynthesisMessageIdRef.current = '';
      }
    }
  }

  async function synthesizePhraseAssistantReply(messageId, text, runId) {
    if (!refParams) return;

    const phrases = splitLiveReplyPhrases(text);
    if (phrases.length === 0) return;

    currentSynthesisMessageIdRef.current = messageId;
    cancelledReplyIdsRef.current.delete(messageId);
    pauseOpenAiInput();
    setSelectedReplyId('');
    setPhase('speaking');
    patchMessage(messageId, {
      status: 'generating_voice',
      error: null,
      audioParts: phrases.map((phrase, index) => ({
        id: `${messageId}-part-${index + 1}`,
        index: index + 1,
        text: phrase,
        status: 'queued',
        audioUrl: null,
        error: null,
      })),
    });

    try {
      for (let index = 0; index < phrases.length; index += 1) {
        const partId = `${messageId}-part-${index + 1}`;
        if (
          isCancelledRef.current ||
          runId !== runIdRef.current ||
          cancelledReplyIdsRef.current.has(messageId)
        ) {
          return;
        }

        patchAudioPart(messageId, partId, { status: 'generating', error: null });
        const blob = await synthesizeSentenceWithRetry(
          buildLiveSentenceParams(phrases[index], refParams, liveLanguage)
        );

        if (
          isCancelledRef.current ||
          runId !== runIdRef.current ||
          cancelledReplyIdsRef.current.has(messageId)
        ) {
          return;
        }

        const url = URL.createObjectURL(blob);
        patchAudioPart(messageId, partId, { status: 'ready', audioUrl: url, error: null });
        if (!selectedReplyIdRef.current && phaseRef.current === 'speaking') {
          setSelectedReplyId(partId);
        }
      }

      if (!cancelledReplyIdsRef.current.has(messageId)) {
        patchMessage(messageId, { status: 'ready' });
        const message = messagesRef.current.find((item) => item.id === messageId);
        if (!selectedReplyIdRef.current) {
          const nextPart = firstReadyPart(message);
          if (nextPart) {
            setSelectedReplyId(nextPart.id);
          }
        }
      }
    } catch (err) {
      if (isCancelledRef.current || runId !== runIdRef.current) return;

      patchMessage(messageId, {
        status: 'error',
        error: err.message || 'Voice generation failed',
      });
      setError(`Voice reply failed: ${err.message}`);
      setSelectedReplyId('');
      const nextPhase = socketRef.current ? 'listening' : 'idle';
      setPhase(nextPhase);
      syncOpenAiInputWithMic(nextPhase);
    } finally {
      if (currentSynthesisMessageIdRef.current === messageId) {
        currentSynthesisMessageIdRef.current = '';
      }
    }
  }

  function synthesizeAssistantReply(messageId, text, runId) {
    if (isPhraseMode) {
      synthesizePhraseAssistantReply(messageId, text, runId);
      return;
    }

    synthesizeFullAssistantReply(messageId, text, runId);
  }

  function closeSocket() {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  }

  function stopMicCapture() {
    setAudioLevel(0);
    setMicInputEnabled(false);
    setBargeInArmed(false);

    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      try { processorRef.current.disconnect(); } catch { /* ignore */ }
      processorRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch { /* ignore */ }
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  function endConversationFromSocket() {
    socketRef.current = null;
    stopMicCapture();
    setInterimTranscript('');
    setPhase('idle');
  }

  function interruptPlayback() {
    if (phaseRef.current !== 'speaking') return;
    const playback = findSelectedPlayback(messagesRef.current, selectedReplyIdRef.current);
    const currentReplyId = playback?.message.id || currentSynthesisMessageIdRef.current;
    if (!playback && !currentReplyId) return;

    if (currentReplyId) {
      cancelledReplyIdsRef.current.add(currentReplyId);
      patchMessage(currentReplyId, { status: 'interrupted' });
    }
    if (playback?.part) {
      patchAudioPart(playback.message.id, playback.part.id, { status: 'interrupted' });
    }

    setSelectedReplyId('');
    setPhase('listening');
    syncOpenAiInputWithMic('listening');
    setInterimTranscript(micInputEnabledRef.current ? 'Listening...' : '');
    showNotice(micInputEnabledRef.current ? 'Voice stopped. Listening...' : 'Voice stopped. Mic is off.');
  }

  function playReply(messageId) {
    const message = messagesRef.current.find((item) => item.id === messageId);
    if (!message || message.role !== 'assistant') return;
    const playbackId = isPhraseMode ? findFirstReplayablePart(message)?.id : message.id;
    if (!playbackId) return;
    pauseOpenAiInput();
    setSelectedReplyId(playbackId);
    setPhase('speaking');
  }

  function sendAudioChunk(input, sampleRate) {
    try {
      const sent = socketRef.current?.send({
        type: 'audio.chunk',
        audio: encodeOpenAiAudioChunk(input, sampleRate),
      });
      return Boolean(sent);
    } catch (err) {
      setError(`Live audio failed: ${err.message}`);
      return false;
    }
  }

  function armBargeInMonitor() {
    setAudioLevel(0);
    setMicInputEnabled(false);
    setBargeInArmed(true);
  }

  async function requestMicStream() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support live microphone recording.');
    }

    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  }

  function startMicCapture(stream) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      setSpeechApiAvailable(false);
      throw new Error('This browser does not support live audio processing.');
    }

    const audioCtx = new AudioContextCtor();
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioCtx.destination);

    audioContextRef.current = audioCtx;
    sourceRef.current = source;
    processorRef.current = processor;
    setSpeechApiAvailable(true);
    setMicInputEnabled(true);

    let smoothedLevel = 0;
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);

      const rms = getRms(input);
      smoothedLevel = smoothedLevel * 0.82 + rms * 0.18;
      setAudioLevel(Math.min(1, smoothedLevel * 5));

      let sentForBargeIn = false;
      if (shouldTriggerLiveBargeIn({
        phase: phaseRef.current,
        micInputEnabled: micInputEnabledRef.current || bargeInArmedRef.current,
        rms: smoothedLevel,
      })) {
        bargeInFramesRef.current += 1;
      } else {
        bargeInFramesRef.current = 0;
      }

      if (
        bargeInFramesRef.current >= BARGE_IN_MIN_FRAMES
        && Date.now() - lastBargeInAtRef.current > BARGE_IN_COOLDOWN_MS
      ) {
        lastBargeInAtRef.current = Date.now();
        bargeInFramesRef.current = 0;
        setMicInputEnabled(true);
        setBargeInArmed(false);
        interruptPlayback();
        sentForBargeIn = sendAudioChunk(input, audioCtx.sampleRate);
        if (sentForBargeIn && rms > 0.006) {
          pendingInputAudioRef.current = true;
        }
      }

      if (shouldSendLiveMicAudio({
        phase: phaseRef.current,
        micInputEnabled: micInputEnabledRef.current,
      }) && !sentForBargeIn) {
        const sent = sendAudioChunk(input, audioCtx.sampleRate);
        if (sent && rms > 0.006) {
          pendingInputAudioRef.current = true;
        }
      }
    };
  }

  async function enableMicInput() {
    if (phaseRef.current === 'idle') {
      start();
      return;
    }
    if (micInputEnabledRef.current) return;

    if (processorRef.current && streamRef.current) {
      setMicInputEnabled(true);
      setBargeInArmed(false);
      syncOpenAiInputWithMic();
      if (isLiveInputPhase(phaseRef.current)) {
        setInterimTranscript('Listening...');
      }
      showNotice('Mic on.');
      return;
    }

    try {
      const stream = await requestMicStream();
      streamRef.current = stream;
      startMicCapture(stream);
      syncOpenAiInputWithMic();
      if (isLiveInputPhase(phaseRef.current)) {
        setInterimTranscript('Listening...');
      }
      showNotice('Mic on.');
    } catch (err) {
      setError(err.message === 'This browser does not support live microphone recording.'
        ? err.message
        : 'Microphone access denied. Please allow microphone access and try again.');
    }
  }

  function disableMicInput() {
    if (!micInputEnabledRef.current) return;
    const phaseAtToggle = phaseRef.current;
    const action = getMicOffAction({
      phase: phaseAtToggle,
      hasPendingAudio: pendingInputAudioRef.current,
    });

    if (action === 'commit') {
      armBargeInMonitor();
      const id = ensureUserMessage();
      patchMessage(id, { status: 'transcribing', text: 'Transcribing...' });
      setPhase('thinking');
      setInterimTranscript('Thinking...');
      sendManualCommitTail();
      commitOpenAiInput();
      showNotice('Mic off. Sending what you said. You can speak over the reply to interrupt.');
      return;
    }

    stopMicCapture();

    if (action === 'pause') {
      pauseOpenAiInput();
      pendingInputAudioRef.current = false;
    }

    if (phaseAtToggle === 'thinking') {
      setInterimTranscript('Thinking...');
      showNotice('Mic off. Finishing the current reply.');
      return;
    }

    setInterimTranscript('');
    showNotice(phaseAtToggle === 'speaking'
      ? 'Mic off. Voice playback continues.'
      : 'Mic off. Conversation stays open.');
  }

  function handleSocketEvent(event, runId) {
    if (runId !== runIdRef.current || isCancelledRef.current) return;

    switch (event.type) {
      case 'session.ready':
        setPhase('listening');
        setInterimTranscript('Listening...');
        setNotice('');
        break;

      case 'user.speech.started': {
        if (phaseRef.current !== 'speaking') {
          pendingInputAudioRef.current = true;
          ensureUserMessage();
          setPhase('listening');
          setInterimTranscript('Listening...');
        }
        break;
      }

      case 'user.speech.stopped': {
        if (phaseRef.current !== 'speaking') {
          pendingInputAudioRef.current = false;
          const id = ensureUserMessage();
          patchMessage(id, { status: 'transcribing', text: 'Transcribing...' });
          setPhase('thinking');
          setInterimTranscript('Thinking...');
        }
        break;
      }

      case 'user.text.delta': {
        const id = ensureUserMessage(event.itemId);
        const key = event.itemId || id;
        const nextText = `${userTextBuffersRef.current.get(key) || ''}${event.text || ''}`;
        userTextBuffersRef.current.set(key, nextText);
        patchMessage(id, { itemId: event.itemId || '', text: nextText, status: 'transcribing' });
        break;
      }

      case 'user.text.done': {
        const id = ensureUserMessage(event.itemId);
        const key = event.itemId || id;
        userTextBuffersRef.current.delete(key);
        pendingInputAudioRef.current = false;
        patchMessage(id, {
          itemId: event.itemId || '',
          text: cleanLiveText(event.text) || 'Voice message sent.',
          status: 'done',
        });
        if (activeUserMessageIdRef.current === id) {
          activeUserMessageIdRef.current = '';
        }
        break;
      }

      case 'user.text.failed': {
        const id = ensureUserMessage(event.itemId);
        pendingInputAudioRef.current = false;
        patchMessage(id, {
          text: 'Voice message sent.',
          status: 'done',
          error: event.message || null,
        });
        if (activeUserMessageIdRef.current === id) {
          activeUserMessageIdRef.current = '';
        }
        break;
      }

      case 'assistant.thinking':
        if (phaseRef.current !== 'speaking') {
          setPhase('thinking');
          setInterimTranscript('Thinking...');
        }
        break;

      case 'assistant.text.delta': {
        const id = ensureAssistantMessage();
        assistantTextRef.current += event.text || '';
        patchMessage(id, { text: assistantTextRef.current, status: 'thinking' });
        setInterimTranscript(assistantTextRef.current);
        break;
      }

      case 'assistant.text.done': {
        const text = cleanLiveText(event.text || assistantTextRef.current || '');
        assistantTextRef.current = '';
        setInterimTranscript('');
        if (text) {
          const id = ensureAssistantMessage();
          activeAssistantMessageIdRef.current = '';
          patchMessage(id, { text, status: 'generating_voice' });
          synthesizeAssistantReply(id, text, runId);
        } else if (phaseRef.current !== 'speaking') {
          setPhase('listening');
        }
        break;
      }

      case 'error':
        setError(event.message || 'AI conversation failed.');
        if (phaseRef.current !== 'speaking') {
          setPhase('listening');
        }
        break;

      case 'session.closed':
        if (phaseRef.current !== 'idle') {
          endConversationFromSocket();
        }
        break;

      default:
        break;
    }
  }

  async function start() {
    if (phaseRef.current !== 'idle') return;
    if (!refParams) {
      setError('No reference audio configured. Go to the Inference page first.');
      return;
    }
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    isCancelledRef.current = false;
    messageSeqRef.current = 0;
    assistantTextRef.current = '';
    cleanupConversation();

    setError(null);
    setNotice('');
    setInterimTranscript('');
    setPhase('connecting');

    let stream;
    try {
      stream = await requestMicStream();
    } catch (err) {
      setPhase('idle');
      setError(err.message === 'This browser does not support live microphone recording.'
        ? err.message
        : 'Microphone access denied. Please allow microphone access and try again.');
      return;
    }

    try {
      streamRef.current = stream;
      startMicCapture(stream);
    } catch (err) {
      stopMicCapture();
      setPhase('idle');
      setError(err.message);
      return;
    }

    const socket = createLiveChatSocket({
      language: liveLanguage,
      onOpen: () => {
        if (runId === runIdRef.current) {
          setNotice('Connected. Preparing live chat...');
        }
      },
      onMessage: (event) => handleSocketEvent(event, runId),
      onError: (err) => {
        if (runId !== runIdRef.current) return;
        setError(err.message || 'Live chat connection failed.');
        endConversationFromSocket();
      },
      onClose: () => {
        if (runId !== runIdRef.current) return;
        if (phaseRef.current !== 'idle' && phaseRef.current !== 'stopping') {
          endConversationFromSocket();
        }
      },
    });
    socketRef.current = socket;
  }

  function stop() {
    if (phaseRef.current === 'idle' || phaseRef.current === 'stopping') return;

    isCancelledRef.current = true;
    runIdRef.current += 1;
    setPhase('stopping');
    setInterimTranscript('');
    closeSocket();
    stopMicCapture();
    setPhase('idle');
  }

  function toggle() {
    if (phaseRef.current === 'idle') {
      start();
      return;
    }
    if (phaseRef.current === 'connecting' || phaseRef.current === 'stopping') {
      return;
    }
    if (micInputEnabledRef.current) {
      disableMicInput();
      return;
    }
    enableMicInput();
  }

  function onAudioEnded() {
    const playback = findSelectedPlayback(messagesRef.current, selectedReplyIdRef.current);

    if (isPhraseMode && playback?.part) {
      patchAudioPart(playback.message.id, playback.part.id, { status: 'played' });
      const nextPlayback = findNextPhrasePlayback(messagesRef.current, playback.part.id);
      if (nextPlayback?.part) {
        setSelectedReplyId(nextPlayback.part.id);
        return;
      }

      setSelectedReplyId('');
      if (
        currentSynthesisMessageIdRef.current === playback.message.id ||
        hasPendingParts(playback.message)
      ) {
        setPhase('speaking');
        return;
      }

      if (phaseRef.current === 'speaking') {
        const nextPhase = socketRef.current ? 'listening' : 'idle';
        setPhase(nextPhase);
        syncOpenAiInputWithMic(nextPhase);
        setInterimTranscript(socketRef.current && micInputEnabledRef.current ? 'Listening...' : '');
        if (!micInputEnabledRef.current && bargeInArmedRef.current) {
          stopMicCapture();
        }
      }
      return;
    }

    setSelectedReplyId('');
    if (phaseRef.current === 'speaking') {
      const nextPhase = socketRef.current ? 'listening' : 'idle';
      setPhase(nextPhase);
      syncOpenAiInputWithMic(nextPhase);
      setInterimTranscript(socketRef.current && micInputEnabledRef.current ? 'Listening...' : '');
      if (!micInputEnabledRef.current && bargeInArmedRef.current) {
        stopMicCapture();
      }
    }
  }

  useEffect(() => {
    return () => {
      isCancelledRef.current = true;
      runIdRef.current += 1;
      closeSocket();
      stopMicCapture();
      cleanupConversation();
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, []);

  const selectedPlayback = findSelectedPlayback(messages, selectedReplyId);
  const selectedReply = selectedPlayback?.message || null;
  const selectedAudioPart = selectedPlayback?.part || null;
  const audioSrc = selectedPlayback?.audioUrl || null;
  const shouldPlayAudio = phase === 'speaking' && Boolean(audioSrc);
  const finalTranscript = messages
    .filter((message) => message.text && message.status !== 'listening')
    .map((message) => message.text)
    .join(' ');

  return {
    phase,
    interimTranscript,
    finalTranscript,
    messages,
    selectedReply,
    selectedAudioPart,
    selectedReplyId,
    audioSrc,
    error,
    speechApiAvailable,
    audioLevel,
    isMicInputEnabled: micInputEnabled,
    isBargeInArmed: bargeInArmed,
    notice,
    isConversationActive: phase !== 'idle',
    shouldPlayAudio,
    start,
    stop,
    toggle,
    enableMicInput,
    disableMicInput,
    interruptPlayback,
    playReply,
    onAudioEnded,
  };
}
