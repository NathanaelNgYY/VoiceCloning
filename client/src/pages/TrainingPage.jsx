import React, { useState } from 'react';
import AudioUploader from '../components/AudioUploader.jsx';
import ProgressTracker from '../components/ProgressTracker.jsx';
import LogViewer from '../components/LogViewer.jsx';
import { uploadFiles, startTraining, stopTraining } from '../services/api.js';
import { useSSE } from '../hooks/useSSE.js';

/* ── Shared style builders ── */

const card = {
  background: '#FFFFFF',
  border: '1px solid #E8E4DE',
  borderRadius: '16px',
  padding: '24px',
  marginBottom: '16px',
  boxShadow: '0 1px 3px rgba(26, 22, 20, 0.04), 0 1px 2px rgba(26, 22, 20, 0.02)',
};

const label = {
  display: 'block',
  fontSize: '12px',
  color: '#9B938A',
  marginBottom: '6px',
  fontWeight: 500,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const input = {
  width: '100%',
  padding: '10px 14px',
  background: '#F8F6F3',
  border: '1px solid #E8E4DE',
  borderRadius: '10px',
  color: '#1A1614',
  fontSize: '14px',
  outline: 'none',
  fontFamily: '"DM Sans", sans-serif',
  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
};

const heading = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#1A1614',
  letterSpacing: '-0.01em',
  marginBottom: '18px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontFamily: '"Space Grotesk", sans-serif',
};

/* ── Icons ── */

const SetupIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#E8654A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="12" height="12" rx="3" />
    <path d="M5 8h6M8 5v6" />
  </svg>
);

const PipelineIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#E8654A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="3" cy="8" r="1.5" />
    <circle cx="8" cy="8" r="1.5" />
    <circle cx="13" cy="8" r="1.5" />
    <path d="M4.5 8h2M9.5 8h2" />
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

  const { logs, steps, pipelineStatus, error, connect, disconnect } = useSSE();

  const isRunning = pipelineStatus === 'running';

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
      connect(res.data.sessionId);
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
    } catch (err) {
      console.error('Failed to stop training:', err);
    }
  }

  return (
    <div style={{ animation: 'fade-in 0.4s ease' }}>
      {/* Setup Section */}
      <div style={card}>
        <h2 style={heading}>
          <SetupIcon />
          Setup
        </h2>

        <div style={{ marginBottom: '18px' }}>
          <label style={label}>Experiment Name</label>
          <input
            style={input}
            placeholder="e.g. my_voice_model"
            value={expName}
            onChange={(e) => setExpName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
            disabled={isRunning}
            onFocus={(e) => { e.target.style.borderColor = '#E8654A'; e.target.style.boxShadow = '0 0 0 3px rgba(232, 101, 74, 0.1)'; }}
            onBlur={(e) => { e.target.style.borderColor = '#E8E4DE'; e.target.style.boxShadow = 'none'; }}
          />
          {expName && (
            <p style={{ fontSize: '11px', color: '#B8B0A6', marginTop: '4px' }}>
              Only letters, numbers, hyphens, and underscores allowed
            </p>
          )}
        </div>

        <div>
          <label style={label}>Training Audio</label>
          <AudioUploader files={files} onFilesChange={setFiles} disabled={isRunning} />
        </div>

        {uploadError && (
          <div style={{
            marginTop: '12px',
            padding: '10px 14px',
            background: 'rgba(217, 69, 69, 0.06)',
            border: '1px solid rgba(217, 69, 69, 0.12)',
            borderRadius: '10px',
            color: '#D94545',
            fontSize: '13px',
          }}>
            {uploadError}
          </div>
        )}
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
            color: '#9B938A',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
            padding: 0,
            fontFamily: '"DM Sans", sans-serif',
            transition: 'color 0.2s ease',
            width: '100%',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#E8654A'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#9B938A'; }}
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
            {/* Batch Size */}
            <div>
              <label style={label}>
                Batch Size
                <span style={{ float: 'right', color: '#E8654A', textTransform: 'none', fontWeight: 600 }}>{batchSize}</span>
              </label>
              <input type="range" min="1" max="4" value={batchSize}
                onChange={e => setBatchSize(Number(e.target.value))} disabled={isRunning} />
            </div>

            {/* ASR Language */}
            <div>
              <label style={label}>ASR Language</label>
              <select
                style={input}
                value={asrLanguage}
                onChange={e => setAsrLanguage(e.target.value)}
                disabled={isRunning}
                onFocus={(e) => { e.target.style.borderColor = '#E8654A'; e.target.style.boxShadow = '0 0 0 3px rgba(232, 101, 74, 0.1)'; }}
                onBlur={(e) => { e.target.style.borderColor = '#E8E4DE'; e.target.style.boxShadow = 'none'; }}
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
              <label style={label}>
                SoVITS Epochs
                <span style={{ float: 'right', color: '#E8654A', textTransform: 'none', fontWeight: 600 }}>{sovitsEpochs}</span>
              </label>
              <input type="range" min="1" max="50" value={sovitsEpochs}
                onChange={e => setSovitsEpochs(Number(e.target.value))} disabled={isRunning} />
            </div>

            {/* GPT Epochs */}
            <div>
              <label style={label}>
                GPT Epochs
                <span style={{ float: 'right', color: '#E8654A', textTransform: 'none', fontWeight: 600 }}>{gptEpochs}</span>
              </label>
              <input type="range" min="1" max="50" value={gptEpochs}
                onChange={e => setGptEpochs(Number(e.target.value))} disabled={isRunning} />
            </div>

            {/* SoVITS Save Every */}
            <div>
              <label style={label}>
                SoVITS Save Interval
                <span style={{ float: 'right', color: '#E8654A', textTransform: 'none', fontWeight: 600 }}>every {sovitsSaveEvery}ep</span>
              </label>
              <input type="range" min="1" max="10" value={sovitsSaveEvery}
                onChange={e => setSovitsSaveEvery(Number(e.target.value))} disabled={isRunning} />
            </div>

            {/* GPT Save Every */}
            <div>
              <label style={label}>
                GPT Save Interval
                <span style={{ float: 'right', color: '#E8654A', textTransform: 'none', fontWeight: 600 }}>every {gptSaveEvery}ep</span>
              </label>
              <input type="range" min="1" max="10" value={gptSaveEvery}
                onChange={e => setGptSaveEvery(Number(e.target.value))} disabled={isRunning} />
            </div>
          </div>
        )}
      </div>

      {/* Pipeline Progress */}
      <div style={card}>
        <h2 style={heading}>
          <PipelineIcon />
          Pipeline
          {pipelineStatus === 'running' && (
            <span style={{
              fontSize: '11px',
              fontWeight: 500,
              color: '#E8654A',
              background: 'rgba(232, 101, 74, 0.08)',
              padding: '2px 10px',
              borderRadius: '10px',
              marginLeft: '4px',
            }}>
              Running
            </span>
          )}
          {pipelineStatus === 'complete' && (
            <span style={{
              fontSize: '11px',
              fontWeight: 500,
              color: '#2D9D6F',
              background: 'rgba(45, 157, 111, 0.08)',
              padding: '2px 10px',
              borderRadius: '10px',
              marginLeft: '4px',
            }}>
              Complete
            </span>
          )}
          {pipelineStatus === 'error' && (
            <span style={{
              fontSize: '11px',
              fontWeight: 500,
              color: '#D94545',
              background: 'rgba(217, 69, 69, 0.06)',
              padding: '2px 10px',
              borderRadius: '10px',
              marginLeft: '4px',
            }}>
              Error
            </span>
          )}
        </h2>

        <ProgressTracker steps={steps} />

        <div style={{
          marginTop: '20px',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
        }}>
          {!isRunning ? (
            <button
              style={{
                padding: '11px 28px',
                background: uploading ? '#F1EEE9' : 'linear-gradient(135deg, #E8654A, #D94E7A)',
                color: uploading ? '#9B938A' : '#FFFFFF',
                border: 'none',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: uploading ? 'not-allowed' : 'pointer',
                fontFamily: '"DM Sans", sans-serif',
                transition: 'all 0.2s ease',
                boxShadow: uploading ? 'none' : '0 4px 20px rgba(232, 101, 74, 0.25)',
                letterSpacing: '0.01em',
              }}
              onClick={handleStart}
              disabled={uploading || isRunning}
            >
              {uploading ? 'Uploading files...' : 'Start Training'}
            </button>
          ) : (
            <button
              style={{
                padding: '11px 28px',
                background: 'transparent',
                color: '#D94545',
                border: '1px solid rgba(217, 69, 69, 0.25)',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: '"DM Sans", sans-serif',
                transition: 'all 0.2s ease',
              }}
              onClick={handleStop}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(217, 69, 69, 0.06)';
                e.currentTarget.style.borderColor = '#D94545';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'rgba(217, 69, 69, 0.25)';
              }}
            >
              Stop Training
            </button>
          )}

          {error && (
            <span style={{
              color: '#D94545',
              fontSize: '13px',
              padding: '6px 12px',
              background: 'rgba(217, 69, 69, 0.06)',
              borderRadius: '8px',
            }}>
              {error}
            </span>
          )}
        </div>
      </div>

      {/* Logs */}
      <div style={card}>
        <h2 style={{ ...heading, marginBottom: '14px' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#E8654A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5l3 2.5L4 10" />
            <path d="M9 10h4" />
          </svg>
          Logs
        </h2>
        <LogViewer logs={logs} />
      </div>
    </div>
  );
}
