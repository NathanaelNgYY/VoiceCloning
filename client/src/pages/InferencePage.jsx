import React, { useState, useEffect, useRef, useCallback } from 'react';
import ModelSelector from '../components/ModelSelector.jsx';
import AudioPlayer from '../components/AudioPlayer.jsx';
import { getModels, selectModels, uploadRefAudio, transcribeAudio, synthesize, getInferenceStatus } from '../services/api.js';

/* ── Shared styles ── */

const card = {
  background: '#111115',
  border: '1px solid #1e1e24',
  borderRadius: '14px',
  padding: '24px',
  marginBottom: '16px',
};

const label = {
  display: 'block',
  fontSize: '12px',
  color: '#6b6b70',
  marginBottom: '6px',
  fontWeight: 500,
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
};

const input = {
  width: '100%',
  padding: '10px 14px',
  background: '#0c0c0f',
  border: '1px solid #2a2a30',
  borderRadius: '8px',
  color: '#e0ddd8',
  fontSize: '14px',
  outline: 'none',
  fontFamily: '"DM Sans", sans-serif',
  transition: 'border-color 0.2s ease',
};

const heading = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#e0ddd8',
  letterSpacing: '-0.01em',
  marginBottom: '18px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

/* ── Icons ── */

const ModelIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#d4a053" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="14" height="8" rx="2" />
    <circle cx="5" cy="8" r="1" fill="#d4a053" stroke="none" />
    <circle cx="8" cy="8" r="1" fill="#d4a053" stroke="none" />
    <circle cx="11" cy="8" r="1" fill="#d4a053" stroke="none" />
  </svg>
);

const RefIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#d4a053" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2v9" />
    <circle cx="8" cy="12" r="2" />
    <path d="M12 5a4 4 0 0 0-8 0" />
  </svg>
);

const TextIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#d4a053" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3h10M8 3v10M5 13h6" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="2" />
    <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M11.2 2.8l-1.4 1.4M4.2 9.8l-1.4 1.4" />
  </svg>
);

const ChevronIcon = ({ open }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ transition: 'transform 0.2s ease', transform: open ? 'rotate(180deg)' : 'rotate(0)' }}>
    <path d="M3 4.5l3 3 3-3" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 2v4h4" />
    <path d="M13 12V8H9" />
    <path d="M2.5 9a5 5 0 008.2 1.8L13 8M1 6l2.3-2.8A5 5 0 0111.5 5" />
  </svg>
);

const GenerateIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="4,2 14,8 4,14" fill="currentColor" stroke="none" />
  </svg>
);

const SpinnerSmall = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
    <circle cx="8" cy="8" r="6" stroke="rgba(12,12,15,0.3)" strokeWidth="2" />
    <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

function formatTime(s) {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="#d4a053" stroke="none">
    <polygon points="4,2 14,8 4,14" />
  </svg>
);

const PauseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="#d4a053" stroke="none">
    <rect x="3" y="2" width="3.5" height="12" rx="1" />
    <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
  </svg>
);

function RefAudioPlayer({ src }) {
  const audioRef = useRef(null);
  const progressRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play(); setPlaying(true); }
    else { a.pause(); setPlaying(false); }
  }, []);

  const handleSeek = useCallback((e) => {
    const bar = progressRef.current;
    const a = audioRef.current;
    if (!bar || !a || !a.duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * a.duration;
  }, []);

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div style={{
      marginTop: '10px',
      padding: '8px 12px',
      background: '#0c0c0f',
      border: '1px solid #2a2a30',
      borderRadius: '8px',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    }}>
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => setPlaying(false)}
      />

      <button
        onClick={togglePlay}
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          border: '1px solid #d4a053',
          background: 'rgba(212, 160, 83, 0.08)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(212, 160, 83, 0.18)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(212, 160, 83, 0.08)'; }}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      <span style={{ fontSize: '11px', color: '#6b6b70', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {formatTime(currentTime)}
      </span>

      <div
        ref={progressRef}
        onClick={handleSeek}
        style={{
          flex: 1,
          height: '6px',
          background: '#1e1e24',
          borderRadius: '3px',
          cursor: 'pointer',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: '100%',
          width: `${progress}%`,
          background: 'linear-gradient(90deg, #d4a053, #c08a3a)',
          borderRadius: '3px',
          transition: 'width 0.1s linear',
        }} />
      </div>

      <span style={{ fontSize: '11px', color: '#6b6b70', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {formatTime(duration)}
      </span>
    </div>
  );
}

export default function InferencePage() {
  const [gptModels, setGptModels] = useState([]);
  const [sovitsModels, setSovitsModels] = useState([]);
  const [selectedGPT, setSelectedGPT] = useState('');
  const [selectedSoVITS, setSelectedSoVITS] = useState('');
  const [serverReady, setServerReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modelError, setModelError] = useState(null);

  const [refAudioPath, setRefAudioPath] = useState('');
  const [refAudioFile, setRefAudioFile] = useState(null);
  const [refAudioUrl, setRefAudioUrl] = useState(null);
  const [promptText, setPromptText] = useState('');
  const [promptLang, setPromptLang] = useState('en');
  const [transcribing, setTranscribing] = useState(false);

  const [text, setText] = useState('');
  const [textLang, setTextLang] = useState('en');

  const [showSettings, setShowSettings] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [topK, setTopK] = useState(5);
  const [topP, setTopP] = useState(1);
  const [temperature, setTemperature] = useState(1);

  const [generating, setGenerating] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [inferError, setInferError] = useState(null);

  useEffect(() => {
    fetchModels();
    checkStatus();
  }, []);

  async function fetchModels() {
    try {
      const res = await getModels();
      setGptModels(res.data.gpt);
      setSovitsModels(res.data.sovits);
    } catch { /* ignore */ }
  }

  async function checkStatus() {
    try {
      const res = await getInferenceStatus();
      setServerReady(res.data.ready);
    } catch { /* ignore */ }
  }

  async function handleLoadModels() {
    if (!selectedGPT || !selectedSoVITS) {
      return alert('Select both GPT and SoVITS models');
    }
    setLoading(true);
    setModelError(null);
    try {
      await selectModels(selectedGPT, selectedSoVITS);
      setServerReady(true);
    } catch (err) {
      setModelError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setRefAudioFile(file);
    // Revoke old blob URL to avoid memory leaks
    if (refAudioUrl) URL.revokeObjectURL(refAudioUrl);
    setRefAudioUrl(URL.createObjectURL(file));
    try {
      const res = await uploadRefAudio(file);
      setRefAudioPath(res.data.path);
    } catch (err) {
      alert('Failed to upload reference audio: ' + (err.response?.data?.error || err.message));
    }
  }

  async function handleTranscribe() {
    if (!refAudioPath) return alert('Upload reference audio first');
    setTranscribing(true);
    try {
      const res = await transcribeAudio(refAudioPath, promptLang);
      setPromptText(res.data.text);
      if (res.data.language) setPromptLang(res.data.language);
    } catch (err) {
      alert('Transcription failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setTranscribing(false);
    }
  }

  async function handleGenerate() {
    if (!text.trim()) return alert('Enter text to synthesize');
    if (!refAudioPath) return alert('Upload reference audio first');
    if (!serverReady) return alert('Load models first');

    setGenerating(true);
    setInferError(null);
    setAudioBlob(null);

    try {
      const blob = await synthesize({
        text,
        text_lang: textLang,
        ref_audio_path: refAudioPath,
        prompt_text: promptText,
        prompt_lang: promptLang,
        top_k: topK,
        top_p: topP,
        temperature,
        speed_factor: speed,
      });
      setAudioBlob(blob);
    } catch (err) {
      setInferError(err.response?.data?.error || err.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={{ animation: 'fade-in 0.4s ease' }}>
      {/* Model Selection */}
      <div style={card}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '18px',
        }}>
          <h2 style={{ ...heading, marginBottom: 0 }}>
            <ModelIcon />
            Model Selection
          </h2>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
            fontWeight: 500,
          }}>
            <div style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background: serverReady ? '#4caf7c' : '#3a3a40',
              boxShadow: serverReady ? '0 0 6px rgba(76, 175, 124, 0.4)' : 'none',
              transition: 'all 0.3s ease',
            }} />
            <span style={{ color: serverReady ? '#4caf7c' : '#4a4a50' }}>
              {serverReady ? 'Server ready' : 'Server offline'}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <ModelSelector
            label="GPT Model"
            models={gptModels}
            value={selectedGPT}
            onChange={setSelectedGPT}
            disabled={loading}
          />
          <ModelSelector
            label="SoVITS Model"
            models={sovitsModels}
            value={selectedSoVITS}
            onChange={setSelectedSoVITS}
            disabled={loading}
          />
        </div>

        <div style={{ marginTop: '16px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              padding: '9px 20px',
              background: loading ? '#18181d' : '#18181d',
              border: `1px solid ${loading ? '#2a2a30' : '#2a2a30'}`,
              borderRadius: '8px',
              color: loading ? '#4a4a50' : '#b0ada6',
              fontSize: '13px',
              fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: '"DM Sans", sans-serif',
              transition: 'all 0.15s ease',
            }}
            onClick={handleLoadModels}
            disabled={loading}
            onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.borderColor = '#d4a053'; e.currentTarget.style.color = '#d4a053'; }}}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2a2a30'; e.currentTarget.style.color = '#b0ada6'; }}
          >
            {loading ? <SpinnerSmall /> : null}
            {loading ? 'Loading...' : 'Load Models'}
          </button>

          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '9px 14px',
              background: 'transparent',
              border: '1px solid #1e1e24',
              borderRadius: '8px',
              color: '#5a5a60',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: '"DM Sans", sans-serif',
              transition: 'all 0.15s ease',
            }}
            onClick={fetchModels}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3a3a42'; e.currentTarget.style.color = '#8a8a90'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#1e1e24'; e.currentTarget.style.color = '#5a5a60'; }}
          >
            <RefreshIcon />
            Refresh
          </button>

          {modelError && (
            <span style={{
              color: '#e85750',
              fontSize: '12px',
              padding: '5px 10px',
              background: 'rgba(232, 87, 80, 0.08)',
              borderRadius: '6px',
            }}>
              {modelError}
            </span>
          )}
        </div>
      </div>

      {/* Reference Audio */}
      <div style={card}>
        <h2 style={heading}>
          <RefIcon />
          Reference Audio
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div>
            <label style={label}>Audio File</label>
            <div style={{
              padding: '14px',
              background: '#0c0c0f',
              border: '1px solid #2a2a30',
              borderRadius: '8px',
            }}>
              <input
                type="file"
                accept=".wav,.mp3,.ogg,.flac"
                onChange={handleRefUpload}
                style={{ fontSize: '13px', color: '#6b6b70', width: '100%' }}
              />
            </div>
            {refAudioFile && (
              <div style={{
                marginTop: '8px',
                padding: '6px 12px',
                background: 'rgba(76, 175, 124, 0.06)',
                border: '1px solid rgba(76, 175, 124, 0.12)',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}>
                <div style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  background: '#4caf7c',
                }} />
                <span style={{ fontSize: '12px', color: '#4caf7c' }}>
                  {refAudioFile.name}
                </span>
              </div>
            )}
            {refAudioUrl && (
              <RefAudioPlayer src={refAudioUrl} />
            )}
          </div>
          <div>
            <label style={label}>Reference Transcript</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                style={{ ...input, flex: 1 }}
                placeholder="What the reference audio says..."
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                onFocus={(e) => { e.target.style.borderColor = '#d4a053'; }}
                onBlur={(e) => { e.target.style.borderColor = '#2a2a30'; }}
              />
              <button
                style={{
                  padding: '8px 14px',
                  background: transcribing ? '#18181d' : '#18181d',
                  border: '1px solid #2a2a30',
                  borderRadius: '8px',
                  color: transcribing ? '#4a4a50' : '#b0ada6',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: transcribing ? 'not-allowed' : 'pointer',
                  fontFamily: '"DM Sans", sans-serif',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                onClick={handleTranscribe}
                disabled={transcribing || !refAudioPath}
                onMouseEnter={(e) => { if (!transcribing && refAudioPath) { e.currentTarget.style.borderColor = '#d4a053'; e.currentTarget.style.color = '#d4a053'; }}}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2a2a30'; e.currentTarget.style.color = '#b0ada6'; }}
              >
                {transcribing ? <SpinnerSmall /> : null}
                {transcribing ? 'Transcribing...' : 'Auto Transcribe'}
              </button>
            </div>
            <div style={{ marginTop: '12px' }}>
              <label style={label}>Reference Language</label>
              <select
                style={input}
                value={promptLang}
                onChange={e => setPromptLang(e.target.value)}
                onFocus={(e) => { e.target.style.borderColor = '#d4a053'; }}
                onBlur={(e) => { e.target.style.borderColor = '#2a2a30'; }}
              >
                <option value="en">English</option>
                <option value="zh">Chinese</option>
                <option value="ja">Japanese</option>
                <option value="ko">Korean</option>
                <option value="auto">Auto Detect</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Text Input */}
      <div style={card}>
        <h2 style={heading}>
          <TextIcon />
          Text to Synthesize
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '20px' }}>
          <div>
            <label style={label}>Text</label>
            <textarea
              style={{
                ...input,
                minHeight: '120px',
                resize: 'vertical',
                lineHeight: '1.6',
              }}
              placeholder="Enter the text you want to synthesize..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={(e) => { e.target.style.borderColor = '#d4a053'; }}
              onBlur={(e) => { e.target.style.borderColor = '#2a2a30'; }}
            />
            {text && (
              <p style={{ fontSize: '11px', color: '#4a4a50', marginTop: '4px', textAlign: 'right' }}>
                {text.length} characters
              </p>
            )}
          </div>
          <div>
            <label style={label}>Language</label>
            <select
              style={input}
              value={textLang}
              onChange={e => setTextLang(e.target.value)}
              onFocus={(e) => { e.target.style.borderColor = '#d4a053'; }}
              onBlur={(e) => { e.target.style.borderColor = '#2a2a30'; }}
            >
              <option value="en">English</option>
              <option value="zh">Chinese</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="auto">Auto Detect</option>
            </select>
          </div>
        </div>
      </div>

      {/* Advanced Settings */}
      <div style={card}>
        <button
          onClick={() => setShowSettings(!showSettings)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'none',
            border: 'none',
            color: '#6b6b70',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
            padding: 0,
            fontFamily: '"DM Sans", sans-serif',
            transition: 'color 0.2s ease',
            width: '100%',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#d4a053'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#6b6b70'; }}
        >
          <SettingsIcon />
          Advanced Settings
          <ChevronIcon open={showSettings} />
        </button>

        {showSettings && (
          <div style={{
            marginTop: '20px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '20px',
            animation: 'fade-in 0.25s ease',
          }}>
            <div>
              <label style={label}>
                Speed
                <span style={{ float: 'right', color: '#d4a053', textTransform: 'none', fontWeight: 600 }}>{speed.toFixed(1)}x</span>
              </label>
              <input type="range" min="0.5" max="2.0" step="0.1" value={speed}
                onChange={e => setSpeed(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={label}>
                Top K
                <span style={{ float: 'right', color: '#d4a053', textTransform: 'none', fontWeight: 600 }}>{topK}</span>
              </label>
              <input type="range" min="1" max="50" value={topK}
                onChange={e => setTopK(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={label}>
                Top P
                <span style={{ float: 'right', color: '#d4a053', textTransform: 'none', fontWeight: 600 }}>{topP.toFixed(2)}</span>
              </label>
              <input type="range" min="0" max="1" step="0.05" value={topP}
                onChange={e => setTopP(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={label}>
                Temperature
                <span style={{ float: 'right', color: '#d4a053', textTransform: 'none', fontWeight: 600 }}>{temperature.toFixed(2)}</span>
              </label>
              <input type="range" min="0" max="1" step="0.05" value={temperature}
                onChange={e => setTemperature(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
          </div>
        )}
      </div>

      {/* Generate */}
      <div style={card}>
        <div style={{
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          marginBottom: audioBlob ? '20px' : '0',
        }}>
          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 32px',
              background: generating ? '#18181d' : 'linear-gradient(135deg, #d4a053, #c08a3a)',
              color: generating ? '#6b6b70' : '#0c0c0f',
              border: 'none',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: generating ? 'not-allowed' : 'pointer',
              fontFamily: '"DM Sans", sans-serif',
              transition: 'all 0.2s ease',
              boxShadow: generating ? 'none' : '0 2px 12px rgba(212, 160, 83, 0.25)',
              letterSpacing: '0.01em',
            }}
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? <SpinnerSmall /> : <GenerateIcon />}
            {generating ? 'Generating...' : 'Generate Speech'}
          </button>

          {inferError && (
            <span style={{
              color: '#e85750',
              fontSize: '12px',
              padding: '6px 12px',
              background: 'rgba(232, 87, 80, 0.08)',
              borderRadius: '6px',
            }}>
              {inferError}
            </span>
          )}
        </div>

        <AudioPlayer audioBlob={audioBlob} />
      </div>
    </div>
  );
}
