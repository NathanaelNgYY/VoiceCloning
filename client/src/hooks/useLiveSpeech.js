import { useState, useEffect, useRef } from 'react';
import { uploadLiveAudio, transcribeAudio, synthesizeSentence } from '../services/api.js';

const V2_SUPPORTED_LANGS = new Set(['zh', 'en', 'ja', 'ko', 'yue', 'auto', 'zh_en']);

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
  const isCancelledRef = useRef(false);
  const currentUrlRef = useRef(null);
  const accumulatedTextRef = useRef('');

  function setPhase(p) {
    phaseRef.current = p;
    setPhaseState(p);
  }

  function onAudioEnded() {
    setPhase('idle');
    // Keep audioSrc so the player stays visible for replay/download
  }

  async function synthesizeAndPlay(text, textLang) {
    try {
      const blob = await synthesizeSentence({
        text,
        text_lang: textLang,
        ref_audio_path: refParams.ref_audio_path,
        prompt_text: refParams.prompt_text,
        prompt_lang: refParams.prompt_lang || 'en',
      });
      if (isCancelledRef.current) return;
      const url = URL.createObjectURL(blob);
      currentUrlRef.current = url;
      setAudioSrc(url);
      setPhase('done');
    } catch (err) {
      if (!isCancelledRef.current) {
        setError(`Synthesis failed: ${err.message}`);
        setPhase('idle');
      }
    }
  }

  async function runPostReleasePipeline(audioBlob) {
    try {
      // Always use Whisper for the authoritative transcript — far more accurate than Web Speech API
      const uploadRes = await uploadLiveAudio(audioBlob);
      const { filePath } = uploadRes.data;
      const transcribeRes = await transcribeAudio(filePath, 'en');
      const { text, language } = transcribeRes.data;

      if (isCancelledRef.current) return;

      if (!text?.trim()) {
        setError('No speech detected. Try speaking louder or closer to the mic.');
        setPhase('idle');
        return;
      }

      // Replace the live Web Speech preview with Whisper's accurate result
      setFinalTranscript(text);
      setInterimTranscript('');

      const textLang = V2_SUPPORTED_LANGS.has(language) ? language : 'en';
      await synthesizeAndPlay(text.trim(), textLang);
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

    isCancelledRef.current = false;
    if (currentUrlRef.current) {
      try { URL.revokeObjectURL(currentUrlRef.current); } catch { /* ignore */ }
      currentUrlRef.current = null;
    }
    accumulatedTextRef.current = '';

    setError(null);
    setInterimTranscript('');
    setFinalTranscript('');
    setAudioSrc(null);

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

    // Web Speech API is display-only — gives live feedback while speaking,
    // but Whisper always produces the final transcript used for synthesis
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
              const segment = result[0].transcript.trim();
              if (segment) {
                accumulatedTextRef.current = accumulatedTextRef.current
                  ? `${accumulatedTextRef.current} ${segment}`
                  : segment;
                setFinalTranscript(accumulatedTextRef.current);
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
    accumulatedTextRef.current = '';

    setPhase('processing');
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
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
      if (currentUrlRef.current) {
        try { URL.revokeObjectURL(currentUrlRef.current); } catch { /* ignore */ }
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
