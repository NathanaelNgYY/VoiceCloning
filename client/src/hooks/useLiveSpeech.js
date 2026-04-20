import { useState, useEffect, useRef } from 'react';
import { connectInferenceSSE } from '../services/sse.js';
import {
  uploadLiveAudio,
  transcribeAudio,
  startGeneration,
  synthesizeSentence,
  getInferenceChunk,
} from '../services/api.js';

export function useLiveSpeech({ refParams }) {
  const [phase, setPhaseState] = useState('idle'); // idle | recording | processing | done
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [audioSrc, setAudioSrc] = useState(null);
  const [error, setError] = useState(null);
  const [speechApiAvailable, setSpeechApiAvailable] = useState(
    typeof window !== 'undefined' &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  );

  const phaseRef = useRef('idle');
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);
  const pendingTextRef = useRef([]);
  const audioQueueRef = useRef([]);
  const isSynthesisingRef = useRef(false);
  const isCancelledRef = useRef(false);
  const currentUrlRef = useRef(null);
  const allUrlsRef = useRef([]);
  const esRef = useRef(null);

  function setPhase(p) {
    phaseRef.current = p;
    setPhaseState(p);
  }

  function advanceAudioQueue() {
    if (audioQueueRef.current.length === 0) {
      currentUrlRef.current = null;
      setAudioSrc(null);
      if (phaseRef.current === 'done' || phaseRef.current === 'processing') {
        setPhase('idle');
      }
      return;
    }
    const url = audioQueueRef.current.shift();
    currentUrlRef.current = url;
    setAudioSrc(url);
  }

  function pushAudioUrl(url) {
    allUrlsRef.current.push(url);
    audioQueueRef.current.push(url);
    if (!currentUrlRef.current) {
      advanceAudioQueue();
    }
  }

  async function drainTextQueue() {
    if (isSynthesisingRef.current) return;
    if (pendingTextRef.current.length === 0) return;
    if (!refParams) return;

    isSynthesisingRef.current = true;
    while (pendingTextRef.current.length > 0 && !isCancelledRef.current) {
      const text = pendingTextRef.current.shift();
      try {
        const blob = await synthesizeSentence({
          text,
          text_lang: refParams.prompt_lang || 'en',
          ref_audio_path: refParams.ref_audio_path,
          prompt_text: refParams.prompt_text,
          prompt_lang: refParams.prompt_lang || 'en',
        });
        if (isCancelledRef.current) break;
        pushAudioUrl(URL.createObjectURL(blob));
      } catch (err) {
        if (!isCancelledRef.current) {
          setError(`Sentence synthesis failed: ${err.message}`);
        }
      }
    }
    isSynthesisingRef.current = false;
  }

  function waitForTextDrain() {
    return new Promise((resolve) => {
      const check = () => {
        if (pendingTextRef.current.length === 0 && !isSynthesisingRef.current) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  async function runFallbackStreaming(text, language) {
    try {
      const genRes = await startGeneration({
        text,
        text_lang: language || 'en',
        ref_audio_path: refParams.ref_audio_path,
        prompt_text: refParams.prompt_text,
        prompt_lang: refParams.prompt_lang || 'en',
      });
      const { sessionId } = genRes.data;

      esRef.current = connectInferenceSSE(sessionId, {
        onChunkComplete(data) {
          if (isCancelledRef.current) return;
          getInferenceChunk(sessionId, data.index)
            .then((blob) => {
              if (!isCancelledRef.current) pushAudioUrl(URL.createObjectURL(blob));
            })
            .catch((err) => {
              if (!isCancelledRef.current) {
                setError(`Failed to load audio chunk: ${err.message}`);
              }
            });
        },
        onComplete() {
          if (esRef.current) { esRef.current.close(); esRef.current = null; }
          if (!isCancelledRef.current) setPhase('done');
        },
        onError(data) {
          if (esRef.current) { esRef.current.close(); esRef.current = null; }
          if (!isCancelledRef.current) {
            setError(data?.message || 'Generation failed');
            setPhase('idle');
          }
        },
      });
    } catch (err) {
      if (!isCancelledRef.current) {
        setError(err.response?.data?.error || err.message || 'Generation failed');
        setPhase('idle');
      }
    }
  }

  async function runPostReleasePipeline(blob) {
    try {
      const uploadRes = await uploadLiveAudio(blob);
      const { filePath } = uploadRes.data;

      const transcribeRes = await transcribeAudio(filePath, 'auto');
      const { text, language } = transcribeRes.data;
      if (!isCancelledRef.current) setFinalTranscript(text || '');

      // Wait for any Track A synthesis to finish before deciding
      await waitForTextDrain();
      if (isCancelledRef.current) return;

      const trackAProducedAudio = allUrlsRef.current.length > 0;
      if (trackAProducedAudio) {
        setPhase('done');
        return;
      }

      if (!text?.trim()) {
        setError('No speech detected. Try speaking louder or closer to the mic.');
        setPhase('idle');
        return;
      }

      await runFallbackStreaming(text, language);
    } catch (err) {
      if (!isCancelledRef.current) {
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

    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    isCancelledRef.current = false;
    pendingTextRef.current = [];
    audioQueueRef.current = [];
    allUrlsRef.current = [];
    isSynthesisingRef.current = false;
    currentUrlRef.current = null;

    setError(null);
    setInterimTranscript('');
    setFinalTranscript('');
    setAudioSrc(null);

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access denied. Please allow microphone access and try again.');
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechApiAvailable(true);
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              const sentence = result[0].transcript.trim();
              if (sentence) {
                pendingTextRef.current.push(sentence);
                drainTextQueue();
              }
            } else {
              interim += result[0].transcript;
            }
          }
          setInterimTranscript(interim);
        };

        recognition.onerror = (event) => {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setSpeechApiAvailable(false);
          }
        };

        recognition.onend = () => {
          recognitionRef.current = null;
        };

        recognition.start();
        recognitionRef.current = recognition;
      } catch {
        setSpeechApiAvailable(false);
      }
    } else {
      setSpeechApiAvailable(false);
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : '';

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const audioBlob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      chunksRef.current = [];
      await runPostReleasePipeline(audioBlob);
    };

    recorder.start();
    setPhase('recording');
  }

  function stop() {
    if (phaseRef.current !== 'recording') return;

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
    setInterimTranscript('');
    setPhase('processing');

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
  }

  function onAudioEnded() {
    const finished = currentUrlRef.current;
    advanceAudioQueue();
    if (finished) {
      try { URL.revokeObjectURL(finished); } catch { /* ignore */ }
    }
  }

  useEffect(() => {
    return () => {
      isCancelledRef.current = true;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (esRef.current) {
        esRef.current.close();
      }
      for (const url of allUrlsRef.current) {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      }
    };
  }, []);

  return {
    phase,
    interimTranscript,
    finalTranscript,
    audioSrc,
    error,
    speechApiAvailable,
    start,
    stop,
    onAudioEnded,
  };
}
