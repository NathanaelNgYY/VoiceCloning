import { useEffect, useRef, useState } from 'react';
import { synthesizeSentence } from '../services/api.js';
import { createLiveChatSocket } from '../services/liveChatSocket.js';

const V2_SUPPORTED_LANGS = new Set(['zh', 'en', 'ja', 'ko', 'yue', 'auto', 'zh_en']);
const QUESTION_START_RE =
  /^(who|what|where|when|why|how|which|whose|can|could|should|would|will|do|does|did|is|are|am|was|were|have|has|had)\b/i;

const LIVE_TARGET_SAMPLE_RATE = 24000;
const LIVE_SPEECH_THRESHOLD = 0.018;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseTextLang(language) {
  return V2_SUPPORTED_LANGS.has(language) ? language : 'en';
}

function predictEnding(text) {
  if (/[.!?]$/.test(text)) return text;
  return `${text}${QUESTION_START_RE.test(text) ? '?' : '.'}`;
}

function splitIntoPhrases(text) {
  const normalised = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalised) return [];

  const matches = normalised.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [normalised];
  return matches
    .map((part) => predictEnding(part.trim()))
    .filter(Boolean);
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

function isInputPhase(phase) {
  return phase === 'listening' || phase === 'thinking';
}

export function useLiveSpeech({ refParams }) {
  const [phase, setPhaseState] = useState('idle');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [audioClips, setAudioClips] = useState([]);
  const [selectedClipId, setSelectedClipIdState] = useState('');
  const [error, setError] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);
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
  const pendingPhrasesRef = useRef([]);
  const isSynthesisingRef = useRef(false);
  const isCancelledRef = useRef(false);
  const runIdRef = useRef(0);
  const clipSeqRef = useRef(0);
  const audioClipsRef = useRef([]);
  const selectedClipIdRef = useRef('');
  const waitingForNextReadyRef = useRef(false);
  const assistantTextRef = useRef('');
  const noticeTimeoutRef = useRef(null);

  function setPhase(phase) {
    phaseRef.current = phase;
    setPhaseState(phase);
  }

  function setSelectedClipId(id) {
    selectedClipIdRef.current = id;
    setSelectedClipIdState(id);
  }

  function setAudioClipsSync(updater) {
    setAudioClips((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      audioClipsRef.current = next;
      return next;
    });
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

  function cleanupGeneratedAudio() {
    for (const clip of audioClipsRef.current) {
      if (clip.url) {
        try {
          URL.revokeObjectURL(clip.url);
        } catch {
          // Ignore object URL cleanup failures.
        }
      }
    }
    audioClipsRef.current = [];
    setAudioClips([]);
    setSelectedClipId('');
    waitingForNextReadyRef.current = false;
  }

  function findNextReadyClip(afterId) {
    const clips = audioClipsRef.current;
    const startIndex = Math.max(0, clips.findIndex((clip) => clip.id === afterId) + 1);
    return clips.slice(startIndex).find((clip) => clip.status === 'ready') || null;
  }

  function pauseOpenAiInput() {
    socketRef.current?.send({ type: 'input.pause' });
  }

  function resumeOpenAiInput() {
    socketRef.current?.send({ type: 'input.resume' });
  }

  function maybeEnterSpeaking() {
    if (phaseRef.current === 'idle' || phaseRef.current === 'stopping') return;
    pauseOpenAiInput();
    setPhase('speaking');
  }

  function maybeSelectReadyClip(clipId) {
    const selected = audioClipsRef.current.find((clip) => clip.id === selectedClipIdRef.current);
    if (!selected || waitingForNextReadyRef.current) {
      waitingForNextReadyRef.current = false;
      setSelectedClipId(clipId);
      maybeEnterSpeaking();
    }
  }

  function selectClip(clipId) {
    const clip = audioClipsRef.current.find((item) => item.id === clipId);
    if (!clip || clip.status !== 'ready') return;
    waitingForNextReadyRef.current = false;
    setSelectedClipId(clipId);
    maybeEnterSpeaking();
  }

  function appendTranscript(text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    setFinalTranscript((prev) => (prev ? `${prev} ${clean}` : clean));
  }

  async function synthesizeWithRetry(params) {
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

  function enqueuePhrase(text, textLang, source, runId, { appendToTranscript = true } = {}) {
    const phrases = splitIntoPhrases(text);
    for (const phrase of phrases) {
      const id = `${source}-${Date.now()}-${clipSeqRef.current + 1}`;
      const index = clipSeqRef.current + 1;
      clipSeqRef.current = index;

      const item = {
        id,
        index,
        text: phrase,
        textLang: normaliseTextLang(textLang),
        source,
        runId,
      };

      pendingPhrasesRef.current.push(item);
      if (appendToTranscript) {
        appendTranscript(phrase);
      }
      setAudioClipsSync((prev) => [
        ...prev,
        {
          id,
          index,
          text: phrase,
          source,
          status: 'generating',
          url: null,
          error: null,
          createdAt: Date.now(),
        },
      ]);
    }

    drainPhraseQueue();
  }

  async function drainPhraseQueue() {
    if (isSynthesisingRef.current) return;
    if (!refParams) return;

    isSynthesisingRef.current = true;
    while (pendingPhrasesRef.current.length > 0 && !isCancelledRef.current) {
      const item = pendingPhrasesRef.current.shift();
      if (!item || item.runId !== runIdRef.current) continue;

      try {
        const blob = await synthesizeWithRetry({
          text: item.text,
          text_lang: item.textLang,
          ref_audio_path: refParams.ref_audio_path,
          prompt_text: refParams.prompt_text,
          prompt_lang: refParams.prompt_lang || 'en',
        });

        if (isCancelledRef.current || item.runId !== runIdRef.current) continue;

        const url = URL.createObjectURL(blob);
        setAudioClipsSync((prev) =>
          prev.map((clip) =>
            clip.id === item.id ? { ...clip, status: 'ready', url, error: null } : clip
          )
        );
        maybeSelectReadyClip(item.id);
      } catch (err) {
        if (isCancelledRef.current || item.runId !== runIdRef.current) continue;

        setAudioClipsSync((prev) =>
          prev.map((clip) =>
            clip.id === item.id
              ? {
                  ...clip,
                  status: 'error',
                  error: err.message || 'Synthesis failed',
                }
              : clip
          )
        );
        setError(`Clip ${item.index} failed: ${err.message}`);
      }
    }

    isSynthesisingRef.current = false;
  }

  function closeSocket() {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  }

  function stopMicCapture() {
    setAudioLevel(0);

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

    socketRef.current?.send({ type: 'response.cancel' });
    setSelectedClipId('');
    waitingForNextReadyRef.current = false;
    resumeOpenAiInput();
    setPhase('listening');
    showNotice('You interrupted. Listening...');
  }

  function sendAudioChunk(input, sampleRate) {
    try {
      socketRef.current?.send({
        type: 'audio.chunk',
        audio: encodeOpenAiAudioChunk(input, sampleRate),
      });
    } catch (err) {
      setError(`Live audio failed: ${err.message}`);
    }
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

    let smoothedLevel = 0;
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);

      const rms = getRms(input);
      smoothedLevel = smoothedLevel * 0.82 + rms * 0.18;
      setAudioLevel(Math.min(1, smoothedLevel * 5));

      if (phaseRef.current === 'speaking') {
        if (rms >= LIVE_SPEECH_THRESHOLD) {
          interruptPlayback();
        }
        return;
      }

      if (isInputPhase(phaseRef.current)) {
        sendAudioChunk(input, audioCtx.sampleRate);
      }
    };
  }

  function handleSocketEvent(event, runId) {
    if (runId !== runIdRef.current || isCancelledRef.current) return;

    switch (event.type) {
      case 'session.ready':
        setPhase('listening');
        setInterimTranscript('Listening...');
        setNotice('');
        break;

      case 'user.speech.started':
        if (phaseRef.current !== 'speaking') {
          setPhase('listening');
          setInterimTranscript('Listening...');
        }
        break;

      case 'user.speech.stopped':
        if (phaseRef.current !== 'speaking') {
          setPhase('thinking');
          setInterimTranscript('Thinking...');
        }
        break;

      case 'assistant.thinking':
        if (phaseRef.current !== 'speaking') {
          setPhase('thinking');
          setInterimTranscript('Thinking...');
        }
        break;

      case 'assistant.text.delta':
        assistantTextRef.current += event.text || '';
        setInterimTranscript(assistantTextRef.current);
        break;

      case 'assistant.text.done': {
        const text = String(event.text || assistantTextRef.current || '').trim();
        assistantTextRef.current = '';
        setInterimTranscript('');
        if (text) {
          enqueuePhrase(text, refParams?.prompt_lang || 'en', 'openai', runId);
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
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support live microphone recording.');
      return;
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    isCancelledRef.current = false;
    pendingPhrasesRef.current = [];
    isSynthesisingRef.current = false;
    clipSeqRef.current = 0;
    assistantTextRef.current = '';
    cleanupGeneratedAudio();

    setError(null);
    setNotice('');
    setInterimTranscript('');
    setFinalTranscript('');
    setPhase('connecting');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      setPhase('idle');
      setError('Microphone access denied. Please allow microphone access and try again.');
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
    if (phaseRef.current === 'speaking') {
      interruptPlayback();
      return;
    }
    stop();
  }

  function onAudioEnded() {
    const nextClip = findNextReadyClip(selectedClipIdRef.current);
    if (nextClip) {
      waitingForNextReadyRef.current = false;
      setSelectedClipId(nextClip.id);
      maybeEnterSpeaking();
      return;
    }

    waitingForNextReadyRef.current = true;
    if (phaseRef.current === 'speaking') {
      resumeOpenAiInput();
      setPhase(socketRef.current ? 'listening' : 'idle');
      setInterimTranscript(socketRef.current ? 'Listening...' : '');
    }
  }

  useEffect(() => {
    return () => {
      isCancelledRef.current = true;
      runIdRef.current += 1;
      closeSocket();
      stopMicCapture();
      cleanupGeneratedAudio();
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, []);

  const selectedClip =
    audioClips.find((clip) => clip.id === selectedClipId) ||
    audioClips.find((clip) => clip.status === 'ready') ||
    null;
  const audioSrc = selectedClip?.status === 'ready' ? selectedClip.url : null;
  const shouldPlayAudio = phase === 'speaking' && Boolean(audioSrc);

  return {
    phase,
    interimTranscript,
    finalTranscript,
    audioClips,
    selectedClip,
    selectedClipId,
    audioSrc,
    error,
    speechApiAvailable,
    audioLevel,
    notice,
    isConversationActive: phase !== 'idle',
    shouldPlayAudio,
    start,
    stop,
    toggle,
    interruptPlayback,
    selectClip,
    onAudioEnded,
  };
}
