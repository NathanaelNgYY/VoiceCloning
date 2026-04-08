import React, { useState, useEffect, useRef, useCallback } from 'react';
import ModelSelector from '../components/ModelSelector.jsx';
import AudioPlayer from '../components/AudioPlayer.jsx';
import { getModels, selectModels, uploadRefAudio, transcribeAudio, synthesize, getInferenceStatus, startGeneration, getGenerationResult, cancelGeneration, getTrainingAudioFiles, getTrainingAudioUrl } from '../services/api.js';
import { useInferenceSSE } from '../hooks/useInferenceSSE.js';

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

  // Multi-upload: array of { name, serverPath, localUrl }
  const [uploadedRefFiles, setUploadedRefFiles] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  const [trainingAudioFiles, setTrainingAudioFiles] = useState([]);
  const [auxRefAudios, setAuxRefAudios] = useState([]);
  const [loadingTrainingAudio, setLoadingTrainingAudio] = useState(false);
  const [refLocked, setRefLocked] = useState(false);

  const [text, setText] = useState('');
  const [textLang, setTextLang] = useState('en');

  const [showSettings, setShowSettings] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [topK, setTopK] = useState(12);
  const [topP, setTopP] = useState(0.85);
  const [temperature, setTemperature] = useState(0.65);
  const [repPenalty, setRepPenalty] = useState(1.35);

  const [audioBlob, setAudioBlob] = useState(null);
  const [inferError, setInferError] = useState(null);
  const sessionIdRef = useRef(null);

  const inference = useInferenceSSE();

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

  function extractExpName(modelPath) {
    if (!modelPath) return null;
    const basename = modelPath.replace(/\\/g, '/').split('/').pop();
    // SoVITS: {expName}_e{N}_s{N}.pth
    let match = basename.match(/^(.+?)_e\d+_s\d+\.pth$/);
    if (match) return match[1];
    // GPT: {expName}-e{N}.ckpt
    match = basename.match(/^(.+?)-e\d+\.ckpt$/);
    if (match) return match[1];
    return null;
  }

  const currentExpName = extractExpName(selectedSoVITS) || extractExpName(selectedGPT);

  useEffect(() => {
    if (!currentExpName) return;
    setRefLocked(false);
    setLoadingTrainingAudio(true);
    getTrainingAudioFiles(currentExpName)
      .then(res => setTrainingAudioFiles(res.data.files || []))
      .catch(() => setTrainingAudioFiles([]))
      .finally(() => setLoadingTrainingAudio(false));
  }, [currentExpName]);

  function handleSelectTrainingAudio(file) {
    setRefAudioPath(file.path);
    setRefAudioFile({ name: file.filename });
    setRefAudioUrl(getTrainingAudioUrl(currentExpName, file.filename));
    setPromptText(file.transcript);
    if (file.lang) {
      const langMap = { ZH: 'zh', EN: 'en', JA: 'ja', KO: 'ko', zh: 'zh', en: 'en', ja: 'ja', ko: 'ko' };
      setPromptLang(langMap[file.lang] || 'en');
    }
    // Remove from aux if it was there
    setAuxRefAudios(prev => prev.filter(f => f.filename !== file.filename));
  }

  function handleToggleAuxRef(file) {
    setAuxRefAudios(prev => {
      const exists = prev.some(f => f.filename === file.filename);
      if (exists) return prev.filter(f => f.filename !== file.filename);
      return [...prev, file];
    });
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
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setUploadingFiles(true);

    const newEntries = [];
    for (const file of files) {
      try {
        const res = await uploadRefAudio(file);
        newEntries.push({
          name: file.name,
          serverPath: res.data.path,
          localUrl: URL.createObjectURL(file),
        });
      } catch (err) {
        alert('Failed to upload ' + file.name + ': ' + (err.response?.data?.error || err.message));
      }
    }

    if (newEntries.length > 0) {
      setUploadedRefFiles(prev => {
        const merged = [...prev, ...newEntries];
        // If no primary yet, set the first one as primary
        if (!refAudioPath || prev.length === 0) {
          setRefAudioFile({ name: merged[0].name });
          if (refAudioUrl) URL.revokeObjectURL(refAudioUrl);
          setRefAudioUrl(merged[0].localUrl);
          setRefAudioPath(merged[0].serverPath);
        }
        return merged;
      });
    }
    setUploadingFiles(false);
    e.target.value = '';
  }

  function handleSetUploadedPrimary(entry) {
    setRefAudioFile({ name: entry.name });
    if (refAudioUrl && !uploadedRefFiles.some(f => f.localUrl === refAudioUrl)) {
      URL.revokeObjectURL(refAudioUrl);
    }
    setRefAudioUrl(entry.localUrl);
    setRefAudioPath(entry.serverPath);
    setPromptText('');
  }

  function handleRemoveUploadedFile(entry) {
    setUploadedRefFiles(prev => {
      const remaining = prev.filter(f => f.serverPath !== entry.serverPath);
      // If we removed the primary, promote the first remaining
      if (entry.serverPath === refAudioPath) {
        if (remaining.length > 0) {
          setRefAudioFile({ name: remaining[0].name });
          setRefAudioUrl(remaining[0].localUrl);
          setRefAudioPath(remaining[0].serverPath);
        } else {
          setRefAudioFile(null);
          setRefAudioUrl(null);
          setRefAudioPath('');
        }
        setPromptText('');
      }
      URL.revokeObjectURL(entry.localUrl);
      return remaining;
    });
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
    if (!refAudioPath) return alert('Select a reference audio first');
    if (!refLocked) return alert('Confirm your reference audio selection first');
    if (!serverReady) return alert('Load models first');

    setInferError(null);
    setAudioBlob(null);

    try {
      const res = await startGeneration({
        text,
        text_lang: textLang,
        ref_audio_path: refAudioPath,
        prompt_text: promptText,
        prompt_lang: promptLang,
        aux_ref_audio_paths: [
          ...auxRefAudios.map(f => f.path),
          ...uploadedRefFiles.filter(f => f.serverPath !== refAudioPath).map(f => f.serverPath),
        ],
        top_k: topK,
        top_p: topP,
        temperature,
        repetition_penalty: repPenalty,
        speed_factor: speed,
      });
      const { sessionId } = res.data;
      sessionIdRef.current = sessionId;
      inference.connect(sessionId);
    } catch (err) {
      setInferError(err.response?.data?.error || err.message);
    }
  }

  async function handleCancel() {
    if (sessionIdRef.current) {
      try {
        await cancelGeneration(sessionIdRef.current);
      } catch { /* ignore */ }
    }
  }

  // Fetch the final WAV when generation completes
  useEffect(() => {
    if (inference.status === 'complete' && sessionIdRef.current) {
      getGenerationResult(sessionIdRef.current)
        .then(blob => setAudioBlob(blob))
        .catch(err => setInferError(err.message));
    }
    if (inference.status === 'error' || inference.status === 'cancelled') {
      setInferError(inference.error);
    }
  }, [inference.status]);

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
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h2 style={sectionTitle}>Reference Audio</h2>
              {refLocked && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--text-primary)' }} />
                  <span style={{ fontSize: '10px', color: 'var(--text-primary)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 500 }}>
                    Confirmed
                  </span>
                </div>
              )}
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              {refLocked ? 'Selection locked for generation' : 'Select a primary reference and optional auxiliary audio'}
            </p>
          </div>
        </div>

        {refLocked ? (
          /* ── Locked summary ── */
          <div>
            <div style={{
              padding: '16px 20px',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-elevated)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--text-primary)' }} />
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {refAudioFile?.name || 'Unknown'}
                </span>
                <span style={{ fontSize: '10px', color: 'var(--text-primary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Primary
                </span>
              </div>
              {promptText && (
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px 15px', fontStyle: 'italic' }}>
                  "{promptText}"
                </p>
              )}
              {(() => {
                const auxCount = auxRefAudios.length + uploadedRefFiles.filter(f => f.serverPath !== refAudioPath).length;
                return auxCount > 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginLeft: '15px' }}>
                    + {auxCount} auxiliary reference{auxCount !== 1 ? 's' : ''}
                  </div>
                ) : null;
              })()}
            </div>

            {refAudioUrl && (
              <RefAudioPlayer src={refAudioUrl} />
            )}

            <button
              onClick={() => setRefLocked(false)}
              style={{
                marginTop: '16px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-tertiary)',
                fontSize: '11px',
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                transition: 'all 0.15s ease',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text-primary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M7 1L1 7" />
                <path d="M5 1h2v2" />
              </svg>
              Edit Selection
            </button>
          </div>
        ) : (
          /* ── Unlocked selection UI ── */
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
              {/* Left: audio file list */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Audio Files</label>
                  {(() => {
                    const auxCount = auxRefAudios.length + uploadedRefFiles.filter(f => f.serverPath !== refAudioPath).length;
                    return auxCount > 0 ? (
                      <span style={{
                        fontSize: '10px',
                        color: 'var(--text-primary)',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '10px',
                        padding: '2px 8px',
                        fontWeight: 600,
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {auxCount} aux
                      </span>
                    ) : null;
                  })()}
                </div>

                {/* Training audio list */}
                {loadingTrainingAudio ? (
                  <div style={{
                    padding: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: 'var(--text-tertiary)',
                    fontSize: '13px',
                  }}>
                    <SpinnerSmall /> Loading training audio...
                  </div>
                ) : trainingAudioFiles.length > 0 ? (
                  <>
                    <div style={{
                      maxHeight: '280px',
                      overflowY: 'auto',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-elevated)',
                    }}>
                      {trainingAudioFiles.map((file) => {
                        const isPrimary = file.path === refAudioPath;
                        const isAux = auxRefAudios.some(f => f.filename === file.filename);
                        return (
                          <div
                            key={file.filename}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '8px 12px',
                              borderBottom: '1px solid var(--border-hairline)',
                              background: isPrimary ? 'var(--bg-surface)' : 'transparent',
                              transition: 'background 0.1s ease',
                            }}
                          >
                            <input
                              type="radio"
                              name="primary-ref"
                              checked={isPrimary}
                              onChange={() => handleSelectTrainingAudio(file)}
                              title="Set as primary reference"
                              style={{ accentColor: 'var(--text-primary)', cursor: 'pointer', flexShrink: 0 }}
                            />
                            <input
                              type="checkbox"
                              checked={isAux}
                              disabled={isPrimary}
                              onChange={() => handleToggleAuxRef(file)}
                              title={isPrimary ? 'Primary ref cannot also be auxiliary' : 'Toggle as auxiliary reference'}
                              style={{
                                accentColor: 'var(--text-primary)',
                                cursor: isPrimary ? 'not-allowed' : 'pointer',
                                opacity: isPrimary ? 0.3 : 1,
                                flexShrink: 0,
                              }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{
                                fontSize: '12px',
                                color: 'var(--text-secondary)',
                                fontFamily: 'var(--font-mono)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}>
                                {file.filename}
                              </div>
                              {file.transcript && (
                                <div style={{
                                  fontSize: '11px',
                                  color: 'var(--text-muted)',
                                  marginTop: '2px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}>
                                  {file.transcript}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{
                      marginTop: '6px',
                      fontSize: '10px',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      gap: '12px',
                    }}>
                      <span>Radio = primary ref</span>
                      <span>Checkbox = auxiliary ref</span>
                    </div>
                    {auxRefAudios.length > 0 && (
                      <button
                        onClick={() => setAuxRefAudios([])}
                        style={{
                          marginTop: '4px',
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          fontSize: '10px',
                          fontFamily: 'var(--font-body)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          padding: 0,
                        }}
                      >
                        Clear auxiliary selections
                      </button>
                    )}
                  </>
                ) : currentExpName ? (
                  <div style={{
                    padding: '16px',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)',
                    textAlign: 'center',
                  }}>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                      No training audio found for "{currentExpName}"
                    </p>
                  </div>
                ) : (
                  <div style={{
                    padding: '16px',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)',
                    textAlign: 'center',
                  }}>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                      Load a model to browse its training audio
                    </p>
                  </div>
                )}

                {/* Upload custom files */}
                <div style={{ marginTop: '16px' }}>
                  <label style={labelStyle}>Or Upload Custom Audio</label>
                  <div style={{
                    padding: '12px 16px',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}>
                    <input
                      type="file"
                      accept=".wav,.mp3,.ogg,.flac"
                      multiple
                      onChange={handleRefUpload}
                      style={{ fontSize: '13px', color: 'var(--text-tertiary)', flex: 1 }}
                    />
                    {uploadingFiles && <SpinnerSmall />}
                  </div>
                </div>

                {/* Uploaded file list */}
                {uploadedRefFiles.length > 0 && (
                  <div style={{
                    marginTop: '8px',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)',
                    maxHeight: '160px',
                    overflowY: 'auto',
                  }}>
                    {uploadedRefFiles.map((entry) => {
                      const isPrimary = entry.serverPath === refAudioPath;
                      return (
                        <div
                          key={entry.serverPath}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '8px 12px',
                            borderBottom: '1px solid var(--border-hairline)',
                            background: isPrimary ? 'var(--bg-surface)' : 'transparent',
                            transition: 'background 0.1s ease',
                          }}
                        >
                          <input
                            type="radio"
                            name="primary-ref"
                            checked={isPrimary}
                            onChange={() => handleSetUploadedPrimary(entry)}
                            title="Set as primary reference"
                            style={{ accentColor: 'var(--text-primary)', cursor: 'pointer', flexShrink: 0 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: '12px',
                              color: 'var(--text-secondary)',
                              fontFamily: 'var(--font-mono)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {entry.name}
                            </div>
                            <div style={{
                              fontSize: '10px',
                              color: isPrimary ? 'var(--text-primary)' : 'var(--text-muted)',
                              marginTop: '1px',
                              fontWeight: isPrimary ? 600 : 400,
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                            }}>
                              {isPrimary ? 'Primary (uploaded)' : 'Auxiliary (uploaded)'}
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveUploadedFile(entry)}
                            title="Remove"
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: '2px',
                              display: 'flex',
                              alignItems: 'center',
                              flexShrink: 0,
                              transition: 'color 0.15s ease',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                              <path d="M3 3l6 6M9 3l-6 6" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right: transcript + language + player */}
              <div>
                <label style={labelStyle}>Reference Transcript</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder="What the primary reference audio says..."
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
                {refAudioUrl && (
                  <div style={{ marginTop: '16px' }}>
                    <label style={labelStyle}>Preview</label>
                    <RefAudioPlayer src={refAudioUrl} />
                  </div>
                )}
              </div>
            </div>

            {/* Confirm button */}
            <div style={{ marginTop: '24px' }}>
              <button
                onClick={() => {
                  if (!refAudioPath) return alert('Select a primary reference audio first');
                  setRefLocked(true);
                }}
                disabled={!refAudioPath}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 24px',
                  background: refAudioPath ? 'var(--text-primary)' : 'var(--bg-elevated)',
                  color: refAudioPath ? 'var(--bg-elevated)' : 'var(--text-muted)',
                  border: refAudioPath ? 'none' : '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: refAudioPath ? 'pointer' : 'not-allowed',
                  fontFamily: 'var(--font-body)',
                  transition: 'all 0.15s ease',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
                onMouseEnter={(e) => { if (refAudioPath) e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2 6 5 9 10 3" />
                </svg>
                Confirm Selection
              </button>
            </div>
          </div>
        )}
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
            <div>
              <label style={labelStyle}>
                Repetition Penalty
                <span style={{ float: 'right', color: 'var(--text-primary)', textTransform: 'none', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{repPenalty.toFixed(2)}</span>
              </label>
              <input type="range" min="1.0" max="2.0" step="0.05" value={repPenalty}
                onChange={e => setRepPenalty(Number(e.target.value))} style={{ width: '100%' }} />
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

        {inference.status !== 'generating' ? (
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
                background: 'var(--text-primary)',
                color: 'var(--bg-elevated)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                transition: 'all 0.15s ease',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
              onClick={() => { inference.reset(); handleGenerate(); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--text-primary)'; }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" stroke="none">
                <polygon points="3,1 11,6 3,11" />
              </svg>
              Generate Speech
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
        ) : (
          /* ── Progress UI ── */
          <div style={{ marginBottom: audioBlob ? '28px' : '0' }}>
            {/* Progress bar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              marginBottom: '16px',
            }}>
              <div style={{
                flex: 1,
                height: '4px',
                background: 'var(--border-default)',
                borderRadius: '2px',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: inference.totalChunks > 0 ? `${(inference.completedChunks / inference.totalChunks) * 100}%` : '0%',
                  background: 'var(--text-primary)',
                  borderRadius: '2px',
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <span style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}>
                {inference.completedChunks} / {inference.totalChunks}
              </span>
            </div>

            {/* Current chunk text */}
            {inference.currentChunkText && (
              <div style={{
                padding: '10px 14px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '16px',
              }}>
                <span style={{
                  fontSize: '10px',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontWeight: 500,
                  display: 'block',
                  marginBottom: '6px',
                }}>
                  Synthesizing chunk {inference.completedChunks + 1}
                </span>
                <p style={{
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                  margin: 0,
                  fontStyle: 'italic',
                }}>
                  {inference.currentChunkText}
                </p>
              </div>
            )}

            {/* Cancel button */}
            <button
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 24px',
                background: 'transparent',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                transition: 'all 0.15s ease',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
              onClick={handleCancel}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <SpinnerSmall />
              Cancel Generation
            </button>
          </div>
        )}

        <AudioPlayer audioBlob={audioBlob} />
      </div>
    </div>
  );
}
