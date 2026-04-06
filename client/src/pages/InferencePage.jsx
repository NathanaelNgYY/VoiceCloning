import React, { useState, useEffect, useRef, useCallback } from 'react';
import ModelSelector from '../components/ModelSelector.jsx';
import AudioPlayer from '../components/AudioPlayer.jsx';
import { getModels, selectModels, uploadRefAudio, transcribeAudio, synthesize, getInferenceStatus } from '../services/api.js';

/* ── Editorial shared styles ── */

const section = {
  marginBottom: '56px',
};

const sectionHeader = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '16px',
  marginBottom: '24px',
  paddingBottom: '16px',
  borderBottom: '1px solid var(--border-hairline)',
};

const sectionNumber = {
  fontSize: '48px',
  fontFamily: 'var(--font-display)',
  color: 'var(--border-default)',
  lineHeight: 0.85,
  fontWeight: 400,
  userSelect: 'none',
};

const sectionTitle = {
  fontSize: '18px',
  fontWeight: 400,
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-display)',
  letterSpacing: '-0.01em',
};

const labelStyle = {
  display: 'block',
  fontSize: '10px',
  color: 'var(--text-tertiary)',
  marginBottom: '8px',
  fontWeight: 500,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  fontFamily: 'var(--font-body)',
};

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  fontSize: '14px',
  outline: 'none',
  fontFamily: 'var(--font-body)',
  transition: 'border-color 0.15s ease',
};

/* ── Spinner ── */

const SpinnerSmall = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
    <circle cx="7" cy="7" r="5" stroke="var(--border-default)" strokeWidth="1.5" />
    <path d="M12 7a5 5 0 0 0-5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/* ── Ref Audio Player ── */

function formatTime(s) {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

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
      marginTop: '12px',
      padding: '12px 16px',
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
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
          border: '1px solid var(--border-strong)',
          background: 'var(--bg-elevated)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--text-primary)';
          e.currentTarget.style.borderColor = 'var(--text-primary)';
          e.currentTarget.querySelector('svg').style.color = 'var(--bg-elevated)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--bg-elevated)';
          e.currentTarget.style.borderColor = 'var(--border-strong)';
          e.currentTarget.querySelector('svg').style.color = 'var(--text-primary)';
        }}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" stroke="none" style={{ color: 'var(--text-primary)' }}>
            <rect x="2" y="1" width="3" height="10" rx="0.5" />
            <rect x="7" y="1" width="3" height="10" rx="0.5" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" stroke="none" style={{ color: 'var(--text-primary)' }}>
            <polygon points="3,1 11,6 3,11" />
          </svg>
        )}
      </button>

      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
        {formatTime(currentTime)}
      </span>

      <div
        ref={progressRef}
        onClick={handleSeek}
        style={{
          flex: 1,
          height: '1px',
          background: 'var(--border-default)',
          cursor: 'pointer',
          position: 'relative',
        }}
      >
        <div style={{
          position: 'absolute',
          top: '-1px',
          left: 0,
          height: '3px',
          width: `${progress}%`,
          background: 'var(--text-primary)',
          transition: 'width 0.1s linear',
        }} />
      </div>

      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
        {formatTime(duration)}
      </span>
    </div>
  );
}

/* ── Main Page ── */

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
  const [topP, setTopP] = useState(0.85);
  const [temperature, setTemperature] = useState(0.65);

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

      {/* ── 01 Models ── */}
      <div style={section}>
        <div style={sectionHeader}>
          <span style={sectionNumber}>01</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h2 style={sectionTitle}>Model Selection</h2>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}>
                <div style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: serverReady ? 'var(--text-primary)' : 'var(--border-default)',
                  transition: 'all 0.3s ease',
                }} />
                <span style={{
                  fontSize: '10px',
                  color: serverReady ? 'var(--text-primary)' : 'var(--text-muted)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontWeight: 500,
                }}>
                  {serverReady ? 'Ready' : 'Offline'}
                </span>
              </div>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              Select and load your trained voice models
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
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

        <div style={{ marginTop: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 24px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              color: loading ? 'var(--text-muted)' : 'var(--text-primary)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-body)',
              transition: 'all 0.15s ease',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
            onClick={handleLoadModels}
            disabled={loading}
            onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.background = 'var(--text-primary)'; e.currentTarget.style.color = 'var(--bg-elevated)'; }}}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          >
            {loading ? <SpinnerSmall /> : null}
            {loading ? 'Loading...' : 'Load Models'}
          </button>

          <button
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 16px',
              background: 'transparent',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-tertiary)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              transition: 'all 0.15s ease',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
            onClick={fetchModels}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text-primary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 2v3h3" />
              <path d="M11 10V7H8" />
              <path d="M2 8a4.5 4.5 0 017.4-1.5L11 7M1 5l1.6.5A4.5 4.5 0 0010 4" />
            </svg>
            Refresh
          </button>

          {modelError && (
            <span style={{
              color: 'var(--accent)',
              fontSize: '12px',
              paddingLeft: '8px',
              borderLeft: '2px solid var(--accent)',
            }}>
              {modelError}
            </span>
          )}
        </div>
      </div>

      {/* ── 02 Reference Audio ── */}
      <div style={section}>
        <div style={sectionHeader}>
          <span style={sectionNumber}>02</span>
          <div>
            <h2 style={sectionTitle}>Reference Audio</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              Upload a sample of the voice you want to clone
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
          <div>
            <label style={labelStyle}>Audio File</label>
            <div style={{
              padding: '16px',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-elevated)',
            }}>
              <input
                type="file"
                accept=".wav,.mp3,.ogg,.flac"
                onChange={handleRefUpload}
                style={{ fontSize: '13px', color: 'var(--text-tertiary)', width: '100%' }}
              />
            </div>
            {refAudioFile && (
              <div style={{
                marginTop: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                <div style={{
                  width: '5px', height: '5px', borderRadius: '50%',
                  background: 'var(--text-primary)',
                }} />
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {refAudioFile.name}
                </span>
              </div>
            )}
            {refAudioUrl && (
              <RefAudioPlayer src={refAudioUrl} />
            )}
          </div>
          <div>
            <label style={labelStyle}>Reference Transcript</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                placeholder="What the reference audio says..."
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                onFocus={(e) => { e.target.style.borderColor = 'var(--text-primary)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--border-default)'; }}
              />
              <button
                style={{
                  padding: '8px 16px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  color: transcribing ? 'var(--text-muted)' : 'var(--text-secondary)',
                  fontSize: '11px',
                  fontWeight: 500,
                  cursor: transcribing ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-body)',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
                onClick={handleTranscribe}
                disabled={transcribing || !refAudioPath}
                onMouseEnter={(e) => { if (!transcribing && refAudioPath) { e.currentTarget.style.borderColor = 'var(--text-primary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                {transcribing ? <SpinnerSmall /> : null}
                {transcribing ? 'Working...' : 'Transcribe'}
              </button>
            </div>
            <div style={{ marginTop: '16px' }}>
              <label style={labelStyle}>Reference Language</label>
              <select
                style={inputStyle}
                value={promptLang}
                onChange={e => setPromptLang(e.target.value)}
                onFocus={(e) => { e.target.style.borderColor = 'var(--text-primary)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--border-default)'; }}
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

      {/* ── 03 Text Input ── */}
      <div style={section}>
        <div style={sectionHeader}>
          <span style={sectionNumber}>03</span>
          <div>
            <h2 style={sectionTitle}>Text to Synthesize</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              Enter the text you want spoken in the cloned voice
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '24px' }}>
          <div>
            <label style={labelStyle}>Text</label>
            <textarea
              style={{
                ...inputStyle,
                minHeight: '140px',
                resize: 'vertical',
                lineHeight: '1.7',
              }}
              placeholder="Enter the text you want to synthesize..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={(e) => { e.target.style.borderColor = 'var(--text-primary)'; }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border-default)'; }}
            />
            {text && (
              <p style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                marginTop: '6px',
                textAlign: 'right',
                fontFamily: 'var(--font-mono)',
              }}>
                {text.length} chars
              </p>
            )}
          </div>
          <div>
            <label style={labelStyle}>Language</label>
            <select
              style={inputStyle}
              value={textLang}
              onChange={e => setTextLang(e.target.value)}
              onFocus={(e) => { e.target.style.borderColor = 'var(--text-primary)'; }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border-default)'; }}
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

      {/* ── 04 Settings ── */}
      <div style={section}>
        <div style={sectionHeader}>
          <span style={sectionNumber}>04</span>
          <div>
            <h2 style={sectionTitle}>Generation Settings</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              Fine-tune the synthesis parameters
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowSettings(!showSettings)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
            padding: 0,
            fontFamily: 'var(--font-body)',
            transition: 'color 0.15s ease',
            letterSpacing: '0.02em',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            style={{ transition: 'transform 0.2s ease', transform: showSettings ? 'rotate(90deg)' : 'rotate(0)' }}>
            <path d="M3 1l4 4-4 4" />
          </svg>
          {showSettings ? 'Hide' : 'Show'} parameters
        </button>

        {showSettings && (
          <div style={{
            marginTop: '28px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '28px 40px',
            animation: 'fade-in 0.25s ease',
          }}>
            <div>
              <label style={labelStyle}>
                Speed
                <span style={{ float: 'right', color: 'var(--text-primary)', textTransform: 'none', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{speed.toFixed(1)}x</span>
              </label>
              <input type="range" min="0.5" max="2.0" step="0.1" value={speed}
                onChange={e => setSpeed(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={labelStyle}>
                Top K
                <span style={{ float: 'right', color: 'var(--text-primary)', textTransform: 'none', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{topK}</span>
              </label>
              <input type="range" min="1" max="50" value={topK}
                onChange={e => setTopK(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={labelStyle}>
                Top P
                <span style={{ float: 'right', color: 'var(--text-primary)', textTransform: 'none', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{topK.toFixed ? topP.toFixed(2) : topP}</span>
              </label>
              <input type="range" min="0" max="1" step="0.05" value={topP}
                onChange={e => setTopP(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={labelStyle}>
                Temperature
                <span style={{ float: 'right', color: 'var(--text-primary)', textTransform: 'none', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{temperature.toFixed(2)}</span>
              </label>
              <input type="range" min="0" max="1" step="0.05" value={temperature}
                onChange={e => setTemperature(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
          </div>
        )}
      </div>

      {/* ── 05 Generate ── */}
      <div style={section}>
        <div style={sectionHeader}>
          <span style={sectionNumber}>05</span>
          <div>
            <h2 style={sectionTitle}>Generate</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              Synthesize speech from your text
            </p>
          </div>
        </div>

        <div style={{
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          marginBottom: audioBlob ? '28px' : '0',
        }}>
          <button
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 36px',
              background: generating ? 'var(--bg-surface)' : 'var(--text-primary)',
              color: generating ? 'var(--text-muted)' : 'var(--bg-elevated)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: generating ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-body)',
              transition: 'all 0.15s ease',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
            onClick={handleGenerate}
            disabled={generating}
            onMouseEnter={(e) => { if (!generating) e.currentTarget.style.background = 'var(--accent)'; }}
            onMouseLeave={(e) => { if (!generating) e.currentTarget.style.background = 'var(--text-primary)'; }}
          >
            {generating ? <SpinnerSmall /> : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" stroke="none">
                <polygon points="3,1 11,6 3,11" />
              </svg>
            )}
            {generating ? 'Generating...' : 'Generate Speech'}
          </button>

          {inferError && (
            <span style={{
              color: 'var(--accent)',
              fontSize: '12px',
              paddingLeft: '8px',
              borderLeft: '2px solid var(--accent)',
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
