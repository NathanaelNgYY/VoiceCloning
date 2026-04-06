import React, { useEffect, useRef, useState } from 'react';
import AudioUploader from '../components/AudioUploader.jsx';
import ProgressTracker from '../components/ProgressTracker.jsx';
import LogViewer from '../components/LogViewer.jsx';
import { getCurrentTraining, uploadFiles, startTraining, stopTraining } from '../services/api.js';
import { useSSE } from '../hooks/useSSE.js';

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

export default function TrainingPage() {
  const [expName, setExpName] = useState('');
  const [files, setFiles] = useState([]);
  const [batchSize, setBatchSize] = useState(2);
  const [sovitsEpochs, setSovitsEpochs] = useState(8);
  const [gptEpochs, setGptEpochs] = useState(15);
  const [sovitsSaveEvery, setSovitsSaveEvery] = useState(4);
  const [gptSaveEvery, setGptSaveEvery] = useState(5);
  const [asrLanguage, setAsrLanguage] = useState('en');
  const [showSettings, setShowSettings] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [uploadError, setUploadError] = useState(null);

  const { logs, steps, pipelineStatus, error, connect, disconnect, hydrate } = useSSE();
  const restoredSessionRef = useRef(null);

  const isRunning = pipelineStatus === 'running' || pipelineStatus === 'waiting';

  useEffect(() => {
    let ignore = false;

    async function restoreTrainingState() {
      try {
        const res = await getCurrentTraining();
        const current = res.data;
        if (ignore || !current?.sessionId) return;

        setSessionId(current.sessionId);
        setExpName(current.expName || '');

        if (current.sessionId === restoredSessionRef.current) return;

        const nextState = {
          initialLogs: current.logs || [],
          initialSteps: current.steps || [],
          initialStatus: current.status || 'idle',
          initialError: current.error || null,
        };

        if (current.status === 'running' || current.status === 'waiting') {
          connect(current.sessionId, nextState);
        } else {
          disconnect();
          hydrate(nextState);
        }

        restoredSessionRef.current = current.sessionId;
      } catch (err) {
        console.error('Failed to restore training state:', err);
      }
    }

    restoreTrainingState();

    return () => {
      ignore = true;
    };
  }, [connect, disconnect, hydrate]);

  async function handleStart() {
    if (!expName.trim()) return alert('Enter an experiment name');
    if (files.length === 0) return alert('Upload audio files first');

    setUploadError(null);

    try {
      setUploading(true);
      await uploadFiles(expName, files);
      setUploading(false);

      const res = await startTraining({
        expName,
        batchSize,
        sovitsEpochs,
        gptEpochs,
        sovitsSaveEvery,
        gptSaveEvery,
        asrLanguage,
      });

      setSessionId(res.data.sessionId);
      restoredSessionRef.current = res.data.sessionId;
      connect(res.data.sessionId, { initialStatus: 'waiting' });
    } catch (err) {
      setUploading(false);
      setUploadError(err.response?.data?.error || err.message);
    }
  }

  async function handleStop() {
    if (!sessionId) return;
    try {
      await stopTraining(sessionId);
      disconnect();
      hydrate({
        initialLogs: logs,
        initialSteps: steps,
        initialStatus: 'stopped',
        initialError: 'Training stopped by user',
      });
    } catch (err) {
      console.error('Failed to stop training:', err);
    }
  }

  return (
    <div style={{ animation: 'fade-in 0.4s ease' }}>

      {/* ── 01 Setup ── */}
      <div style={section}>
        <div style={sectionHeader}>
          <span style={sectionNumber}>01</span>
          <div>
            <h2 style={sectionTitle}>Setup</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              Name your experiment and upload training audio
            </p>
          </div>
        </div>

        <div style={{ marginBottom: '28px' }}>
          <label style={labelStyle}>Experiment Name</label>
          <input
            style={inputStyle}
            placeholder="e.g. my_voice_model"
            value={expName}
            onChange={(e) => setExpName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
            disabled={isRunning}
            onFocus={(e) => { e.target.style.borderColor = 'var(--text-primary)'; }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--border-default)'; }}
          />
          {expName && (
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', fontFamily: 'var(--font-mono)' }}>
              Letters, numbers, hyphens, underscores only
            </p>
          )}
        </div>

        <div>
          <label style={labelStyle}>Training Audio</label>
          <AudioUploader files={files} onFilesChange={setFiles} disabled={isRunning} />
        </div>

        {uploadError && (
          <div style={{
            marginTop: '16px',
            padding: '12px 16px',
            background: 'var(--error-soft)',
            borderLeft: '3px solid var(--accent)',
            color: 'var(--accent)',
            fontSize: '13px',
            fontFamily: 'var(--font-body)',
          }}>
            {uploadError}
          </div>
        )}
      </div>

      {/* ── 02 Configuration ── */}
      <div style={section}>
        <div style={sectionHeader}>
          <span style={sectionNumber}>02</span>
          <div>
            <h2 style={sectionTitle}>Configuration</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              Training parameters and settings
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
          {showSettings ? 'Hide' : 'Show'} advanced settings
        </button>

        {showSettings && (
          <div style={{
            marginTop: '28px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '28px 40px',
            animation: 'fade-in 0.25s ease',
          }}>
            {/* Batch Size */}
            <div>
              <label style={labelStyle}>
                Batch Size
                <span style={{ float: 'right', color: 'var(--text-primary)', textTransform: 'none', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{batchSize}</span>
              </label>
              <input type="range" min="1" max="4" value={batchSize}
                onChange={e => setBatchSize(Number(e.target.value))} disabled={isRunning} />
            </div>

            {/* ASR Language */}
            <div>
              <label style={labelStyle}>ASR Language</label>
              <select
                style={inputStyle}
                value={asrLanguage}
                onChange={e => setAsrLanguage(e.target.value)}
                disabled={isRunning}
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

            {/* SoVITS Epochs */}
            <div>
              <label style={labelStyle}>
                SoVITS Epochs
                <span style={{ float: 'right', color: 'var(--text-primary)', textTransform: 'none', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{sovitsEpochs}</span>
              </label>
              <input type="range" min="1" max="50" value={sovitsEpochs}
                onChange={e => setSovitsEpochs(Number(e.target.value))} disabled={isRunning} />
            </div>

            {/* GPT Epochs */}
            <div>
              <label style={labelStyle}>
                GPT Epochs
                <span style={{ float: 'right', color: 'var(--text-primary)', textTransform: 'none', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{gptEpochs}</span>
              </label>
              <input type="range" min="1" max="50" value={gptEpochs}
                onChange={e => setGptEpochs(Number(e.target.value))} disabled={isRunning} />
            </div>

            {/* SoVITS Save Every */}
            <div>
              <label style={labelStyle}>
                SoVITS Save Interval
                <span style={{ float: 'right', color: 'var(--text-primary)', textTransform: 'none', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>every {sovitsSaveEvery}ep</span>
              </label>
              <input type="range" min="1" max="10" value={sovitsSaveEvery}
                onChange={e => setSovitsSaveEvery(Number(e.target.value))} disabled={isRunning} />
            </div>

            {/* GPT Save Every */}
            <div>
              <label style={labelStyle}>
                GPT Save Interval
                <span style={{ float: 'right', color: 'var(--text-primary)', textTransform: 'none', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>every {gptSaveEvery}ep</span>
              </label>
              <input type="range" min="1" max="10" value={gptSaveEvery}
                onChange={e => setGptSaveEvery(Number(e.target.value))} disabled={isRunning} />
            </div>
          </div>
        )}
      </div>

      {/* ── 03 Pipeline ── */}
      <div style={section}>
        <div style={sectionHeader}>
          <span style={sectionNumber}>03</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h2 style={sectionTitle}>Pipeline</h2>
              {pipelineStatus === 'running' && (
                <span style={{
                  fontSize: '10px',
                  fontWeight: 500,
                  color: 'var(--accent)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontFamily: 'var(--font-body)',
                }}>
                  Running
                </span>
              )}
              {pipelineStatus === 'complete' && (
                <span style={{
                  fontSize: '10px',
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontFamily: 'var(--font-body)',
                }}>
                  Complete
                </span>
              )}
              {pipelineStatus === 'error' && (
                <span style={{
                  fontSize: '10px',
                  fontWeight: 500,
                  color: 'var(--accent)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontFamily: 'var(--font-body)',
                }}>
                  Error
                </span>
              )}
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              8-step training pipeline progress
            </p>
          </div>
        </div>

        <ProgressTracker steps={steps} />

        <div style={{
          marginTop: '28px',
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
        }}>
          {!isRunning ? (
            <button
              style={{
                padding: '11px 32px',
                background: uploading ? 'var(--bg-surface)' : 'var(--text-primary)',
                color: uploading ? 'var(--text-muted)' : 'var(--bg-elevated)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: uploading ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--font-body)',
                transition: 'all 0.15s ease',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
              onClick={handleStart}
              disabled={uploading || isRunning}
              onMouseEnter={(e) => { if (!uploading) e.currentTarget.style.background = 'var(--accent)'; }}
              onMouseLeave={(e) => { if (!uploading) e.currentTarget.style.background = 'var(--text-primary)'; }}
            >
              {uploading ? 'Uploading...' : 'Start Training'}
            </button>
          ) : (
            <button
              style={{
                padding: '11px 32px',
                background: 'transparent',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                transition: 'all 0.15s ease',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
              onClick={handleStop}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--accent)';
                e.currentTarget.style.color = 'white';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--accent)';
              }}
            >
              Stop Training
            </button>
          )}

          {error && (
            <span style={{
              color: 'var(--accent)',
              fontSize: '13px',
              paddingLeft: '8px',
              borderLeft: '2px solid var(--accent)',
            }}>
              {error}
            </span>
          )}
        </div>
      </div>

      {/* ── 04 Logs ── */}
      <div style={section}>
        <div style={sectionHeader}>
          <span style={sectionNumber}>04</span>
          <div>
            <h2 style={sectionTitle}>Logs</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              Real-time training output
            </p>
          </div>
        </div>
        <LogViewer logs={logs} />
      </div>
    </div>
  );
}
