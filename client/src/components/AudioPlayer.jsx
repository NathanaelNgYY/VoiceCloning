import React, { useState, useEffect } from 'react';

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 2v8M4 7l3 3 3-3" />
    <path d="M2 11v1a1 1 0 001 1h8a1 1 0 001-1v-1" />
  </svg>
);

const WaveIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#d4a053" strokeWidth="1.5" strokeLinecap="round">
    <path d="M2 10h1M5 6v8M8 4v12M11 7v6M14 5v10M17 8v4" />
  </svg>
);

export default function AudioPlayer({ audioBlob }) {
  const [audioUrl, setAudioUrl] = useState(null);

  useEffect(() => {
    if (!audioBlob) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(audioBlob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioBlob]);

  if (!audioUrl) return null;

  function handleDownload() {
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `synthesized_${Date.now()}.wav`;
    a.click();
  }

  return (
    <div style={{
      background: '#14141a',
      border: '1px solid #1e1e24',
      borderRadius: '12px',
      padding: '18px',
      animation: 'slide-in 0.4s ease',
    }}>
      {/* Label */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '14px',
      }}>
        <WaveIcon />
        <span style={{
          fontSize: '13px',
          fontWeight: 600,
          color: '#d4a053',
          letterSpacing: '0.01em',
        }}>
          Generated Audio
        </span>
      </div>

      {/* Audio element */}
      <audio
        controls
        src={audioUrl}
        autoPlay
        style={{
          width: '100%',
          height: '40px',
          borderRadius: '8px',
        }}
      />

      {/* Actions */}
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            background: '#18181d',
            border: '1px solid #2a2a30',
            borderRadius: '8px',
            color: '#b0ada6',
            cursor: 'pointer',
            fontSize: '13px',
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            transition: 'all 0.15s ease',
          }}
          onClick={handleDownload}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#d4a053';
            e.currentTarget.style.color = '#d4a053';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#2a2a30';
            e.currentTarget.style.color = '#b0ada6';
          }}
        >
          <DownloadIcon />
          Download WAV
        </button>
      </div>
    </div>
  );
}
