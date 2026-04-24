import { useEffect, useRef, useState } from 'react';
import {
  synthesizeSentence,
  transcribeAudio,
  transcribeLivePhrase,
  uploadLiveAudio,
} from '../services/api.js';

const V2_SUPPORTED_LANGS = new Set(['zh', 'en', 'ja', 'ko', 'yue', 'auto', 'zh_en']);
const QUESTION_START_RE =
  /^(who|what|where|when|why|how|which|whose|can|could|should|would|will|do|does|did|is|are|am|was|were|have|has|had)\b/i;

const LIVE_TARGET_SAMPLE_RATE = 16000;
const LIVE_SPEECH_THRESHOLD = 0.018;
const DEFAULT_LIVE_SILENCE_MS = 1200;
const LIVE_MIN_PHRASE_MS = 700;
const LIVE_MAX_PHRASE_MS = 20000;
const LIVE_PREROLL_MS = 350;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseTextLang(language) {
  return V2_SUPPORTED_LANGS.has(language) ? language : 'en';
}

function getLiveAsrLanguage(refParams) {
  const language = normaliseTextLang(refParams?.prompt_lang || 'en');
  return language === 'auto' || language === 'zh_en' ? 'en' : language;
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

function concatFloat32(chunks, totalLength) {
  const output = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
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

function writeAscii(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += bytesPerSample;
  }

  return buffer;
}

function makeWavBlob(samples, inputSampleRate) {
  const downsampled = downsampleBuffer(samples, inputSampleRate, LIVE_TARGET_SAMPLE_RATE);
  return new Blob([encodeWav(downsampled, LIVE_TARGET_SAMPLE_RATE)], { type: 'audio/wav' });
}

function cloneSamples(input) {
  const copy = new Float32Array(input.length);
  copy.set(input);
  return copy;
}

function getRms(samples) {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sumSq += samples[i] * samples[i];
  }
  return Math.sqrt(sumSq / samples.length);
}

export function useLiveSpeech({ refParams, silenceMs = DEFAULT_LIVE_SILENCE_MS }) {
  const [phase, setPhaseState] = useState('idle'); // idle | recording | processing
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [audioClips, setAudioClips] = useState([]);
  const [selectedClipId, setSelectedClipIdState] = useState('');
  const [error, setError] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [speechApiAvailable, setSpeechApiAvailable] = useState(
    typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext)
  );

  const phaseRef = useRef('idle');
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const pendingPhrasesRef = useRef([]);
  const pendingLiveAudioRef = useRef([]);
  const isSynthesisingRef = useRef(false);
  const isTranscribingLiveRef = useRef(false);
  const isCancelledRef = useRef(false);
  const runIdRef = useRef(0);
  const clipSeqRef = useRef(0);
  const audioClipsRef = useRef([]);
  const selectedClipIdRef = useRef('');
  const waitingForNextReadyRef = useRef(false);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const rafIdRef = useRef(null);
  const preRollChunksRef = useRef([]);
  const preRollSampleCountRef = useRef(0);
  const phraseChunksRef = useRef([]);
  const phraseSampleCountRef = useRef(0);
  const phraseStartedRef = useRef(false);
  const phraseStartMsRef = useRef(0);
  const lastVoiceMsRef = useRef(0);
  const liveClockMsRef = useRef(0);
  const liveInputSampleRateRef = useRef(48000);
  const silenceMsRef = useRef(silenceMs);

  useEffect(() => {
    silenceMsRef.current = silenceMs;
  }, [silenceMs]);

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

  function maybeSelectReadyClip(clipId) {
    const selected = audioClipsRef.current.find((clip) => clip.id === selectedClipIdRef.current);
    if (!selected || waitingForNextReadyRef.current) {
      waitingForNextReadyRef.current = false;
      setSelectedClipId(clipId);
    }
  }

  function selectClip(clipId) {
    const clip = audioClipsRef.current.find((item) => item.id === clipId);
    if (!clip || clip.status !== 'ready') return;
    waitingForNextReadyRef.current = false;
    setSelectedClipId(clipId);
  }

  function appendTranscript(text) {
    setFinalTranscript((prev) => (prev ? `${prev} ${text}` : text));
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

  function waitForPhraseDrain(runId) {
    return new Promise((resolve) => {
      const check = () => {
        const hasPendingForRun = pendingPhrasesRef.current.some((item) => item.runId === runId);
        if (!hasPendingForRun && !isSynthesisingRef.current) {
          resolve();
          return;
        }
        window.setTimeout(check, 120);
      };
      check();
    });
  }

  function waitForLiveTranscriptionDrain(runId) {
    return new Promise((resolve) => {
      const check = () => {
        const hasPendingForRun = pendingLiveAudioRef.current.some((item) => item.runId === runId);
        if (!hasPendingForRun && !isTranscribingLiveRef.current) {
          resolve();
          return;
        }
        window.setTimeout(check, 120);
      };
      check();
    });
  }

  function pushPreRoll(samples, sampleRate) {
    preRollChunksRef.current.push(samples);
    preRollSampleCountRef.current += samples.length;

    const maxSamples = Math.round((sampleRate * LIVE_PREROLL_MS) / 1000);
    while (preRollSampleCountRef.current > maxSamples && preRollChunksRef.current.length > 0) {
      const excess = preRollSampleCountRef.current - maxSamples;
      const first = preRollChunksRef.current[0];
      if (first.length <= excess) {
        preRollChunksRef.current.shift();
        preRollSampleCountRef.current -= first.length;
      } else {
        preRollChunksRef.current[0] = first.slice(excess);
        preRollSampleCountRef.current -= excess;
      }
    }
  }

  function resetPhraseBuffer() {
    phraseStartedRef.current = false;
    phraseStartMsRef.current = 0;
    lastVoiceMsRef.current = 0;
    phraseChunksRef.current = [];
    phraseSampleCountRef.current = 0;
  }

  function startPhrase(samples, nowMs) {
    phraseStartedRef.current = true;
    phraseStartMsRef.current = Math.max(0, nowMs - LIVE_PREROLL_MS);
    lastVoiceMsRef.current = nowMs;
    phraseChunksRef.current = preRollChunksRef.current.map((chunk) => chunk.slice());
    phraseSampleCountRef.current = preRollSampleCountRef.current;
    phraseChunksRef.current.push(samples);
    phraseSampleCountRef.current += samples.length;
    preRollChunksRef.current = [];
    preRollSampleCountRef.current = 0;
    setInterimTranscript('Listening...');
  }

  function appendPhraseSamples(samples) {
    phraseChunksRef.current.push(samples);
    phraseSampleCountRef.current += samples.length;
  }

  function enqueueLiveAudioPhrase(runId) {
    if (!phraseStartedRef.current) return;

    const totalSamples = phraseSampleCountRef.current;
    const durationMs = (totalSamples / liveInputSampleRateRef.current) * 1000;
    const chunks = phraseChunksRef.current;
    resetPhraseBuffer();

    if (durationMs < LIVE_MIN_PHRASE_MS || chunks.length === 0) {
      setInterimTranscript('');
      return;
    }

    try {
      const samples = concatFloat32(chunks, totalSamples);
      const blob = makeWavBlob(samples, liveInputSampleRateRef.current);
      pendingLiveAudioRef.current.push({ blob, runId });
      setInterimTranscript('Transcribing...');
      drainLiveTranscriptionQueue();
    } catch (err) {
      setError(`Live transcription audio failed: ${err.message}`);
      setInterimTranscript('');
    }
  }

  async function drainLiveTranscriptionQueue() {
    if (isTranscribingLiveRef.current) return;

    isTranscribingLiveRef.current = true;
    while (pendingLiveAudioRef.current.length > 0 && !isCancelledRef.current) {
      const item = pendingLiveAudioRef.current.shift();
      if (!item || item.runId !== runIdRef.current) continue;

      try {
        const asrLanguage = getLiveAsrLanguage(refParams);
        const result = await transcribeLivePhrase(item.blob, asrLanguage);
        if (isCancelledRef.current || item.runId !== runIdRef.current) continue;

        const text = result.data?.text?.trim();
        if (text) {
          enqueuePhrase(text, result.data?.language || asrLanguage, 'live', item.runId);
        }
      } catch (err) {
        if (!isCancelledRef.current && item.runId === runIdRef.current) {
          setSpeechApiAvailable(false);
          setError(`Live Faster Whisper failed: ${err.response?.data?.error || err.message}`);
        }
      } finally {
        if (!isCancelledRef.current && item.runId === runIdRef.current) {
          setInterimTranscript(phaseRef.current === 'recording' ? 'Listening...' : '');
        }
      }
    }

    isTranscribingLiveRef.current = false;
  }

  function handleLiveSamples(input, sampleRate, runId) {
    if (runId !== runIdRef.current || phaseRef.current !== 'recording') return;

    const samples = cloneSamples(input);
    const rms = getRms(samples);
    const isVoice = rms >= LIVE_SPEECH_THRESHOLD;
    const nowMs = liveClockMsRef.current + (samples.length / sampleRate) * 1000;
    liveClockMsRef.current = nowMs;

    if (!phraseStartedRef.current) {
      if (isVoice) {
        startPhrase(samples, nowMs);
      } else {
        pushPreRoll(samples, sampleRate);
      }
      return;
    }

    appendPhraseSamples(samples);
    if (isVoice) {
      lastVoiceMsRef.current = nowMs;
    }

    const silenceMs = nowMs - lastVoiceMsRef.current;
    const phraseMs = nowMs - phraseStartMsRef.current;
    if (silenceMs >= silenceMsRef.current || phraseMs >= LIVE_MAX_PHRASE_MS) {
      enqueueLiveAudioPhrase(runId);
    }
  }

  function startLiveAudioCapture(stream, runId) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      setSpeechApiAvailable(false);
      throw new Error('This browser does not support live audio processing.');
    }

    const audioCtx = new AudioContextCtor();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    analyser.fftSize = 256;
    source.connect(analyser);
    source.connect(processor);
    processor.connect(audioCtx.destination);

    audioContextRef.current = audioCtx;
    sourceRef.current = source;
    analyserRef.current = analyser;
    processorRef.current = processor;
    liveInputSampleRateRef.current = audioCtx.sampleRate;
    liveClockMsRef.current = 0;
    preRollChunksRef.current = [];
    preRollSampleCountRef.current = 0;
    resetPhraseBuffer();
    setSpeechApiAvailable(true);

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);
      handleLiveSamples(input, audioCtx.sampleRate, runId);
    };

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    let prevLevel = 0;

    function tick() {
      rafIdRef.current = requestAnimationFrame(tick);
      analyser.getByteTimeDomainData(buffer);
      let sumSq = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const sample = (buffer[i] - 128) / 128;
        sumSq += sample * sample;
      }
      const rms = Math.sqrt(sumSq / buffer.length);
      prevLevel = prevLevel * 0.8 + rms * 0.2;
      setAudioLevel(Math.min(1, prevLevel * 5));
    }

    tick();
  }

  function stopLiveAudioCapture({ flush = false, runId = runIdRef.current } = {}) {
    if (flush) {
      enqueueLiveAudioPhrase(runId);
    }

    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
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
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch { /* ignore */ }
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }

  async function runPostReleasePipeline(audioBlob, runId) {
    try {
      const uploadRes = await uploadLiveAudio(audioBlob);
      const { filePath } = uploadRes.data;
      if (!filePath) {
        throw new Error('Audio upload succeeded but server returned no file path.');
      }

      const transcribeRes = await transcribeAudio(filePath, getLiveAsrLanguage(refParams));
      const { text, language } = transcribeRes.data;

      if (isCancelledRef.current || runId !== runIdRef.current) return;

      const whisperText = String(text || '').trim();
      if (whisperText) {
        setFinalTranscript(whisperText);
      }

      await waitForLiveTranscriptionDrain(runId);
      if (isCancelledRef.current || runId !== runIdRef.current) return;

      const hasLiveWork =
        audioClipsRef.current.length > 0 ||
        pendingPhrasesRef.current.some((item) => item.runId === runId) ||
        isSynthesisingRef.current;

      if (!hasLiveWork) {
        if (!whisperText) {
          setError('No speech detected. Try speaking louder or closer to the mic.');
          setPhase('idle');
          return;
        }
        enqueuePhrase(whisperText, normaliseTextLang(language), 'whisper', runId, {
          appendToTranscript: false,
        });
      }

      await waitForPhraseDrain(runId);
      if (!isCancelledRef.current && runId === runIdRef.current) {
        setInterimTranscript('');
        setPhase('idle');
      }
    } catch (err) {
      if (!isCancelledRef.current && runId === runIdRef.current) {
        setError(err.response?.data?.error || err.message || 'Pipeline failed');
        setPhase('idle');
      }
    }
  }

  async function start() {
    if (phaseRef.current !== 'idle') return;
    if (!refParams) {
      setError('No reference audio configured. Go to the Inference page first.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('This browser does not support live microphone recording.');
      return;
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    isCancelledRef.current = false;
    pendingPhrasesRef.current = [];
    pendingLiveAudioRef.current = [];
    isSynthesisingRef.current = false;
    isTranscribingLiveRef.current = false;
    clipSeqRef.current = 0;
    cleanupGeneratedAudio();

    setError(null);
    setInterimTranscript('');
    setFinalTranscript('');

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
      setError('Microphone access denied. Please allow microphone access and try again.');
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    try {
      startLiveAudioCapture(stream, runId);
    } catch (err) {
      setError(err.message);
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      const audioBlob = new Blob(chunksRef.current, {
        type: recorder.mimeType || 'audio/webm',
      });
      chunksRef.current = [];
      await runPostReleasePipeline(audioBlob, runId);
    };

    recorder.start();
    setPhase('recording');
  }

  function stop() {
    if (phaseRef.current !== 'recording') return;

    stopLiveAudioCapture({ flush: true, runId: runIdRef.current });
    setInterimTranscript('');
    setPhase('processing');

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }

  function toggle() {
    if (phaseRef.current === 'recording') {
      stop();
      return;
    }
    if (phaseRef.current === 'idle') {
      start();
    }
  }

  function onAudioEnded() {
    const nextClip = findNextReadyClip(selectedClipIdRef.current);
    if (nextClip) {
      waitingForNextReadyRef.current = false;
      setSelectedClipId(nextClip.id);
      return;
    }
    waitingForNextReadyRef.current = true;
  }

  useEffect(() => {
    return () => {
      isCancelledRef.current = true;
      runIdRef.current += 1;
      stopLiveAudioCapture({ flush: false });

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      cleanupGeneratedAudio();
    };
  }, []);

  const selectedClip =
    audioClips.find((clip) => clip.id === selectedClipId) ||
    audioClips.find((clip) => clip.status === 'ready') ||
    null;

  return {
    phase,
    interimTranscript,
    finalTranscript,
    audioClips,
    selectedClip,
    selectedClipId,
    audioSrc: selectedClip?.status === 'ready' ? selectedClip.url : null,
    error,
    speechApiAvailable,
    audioLevel,
    start,
    stop,
    toggle,
    selectClip,
    onAudioEnded,
  };
}
