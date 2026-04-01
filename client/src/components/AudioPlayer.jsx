import React, { useState, useEffect } from 'react';

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 2v8M4 7l3 3 3-3" />
    <path d="M2 11v1a1 1 0 001 1h8a1 1 0 001-1v-1" />
  </svg>
);

const WaveIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" strokeLinecap="round">
    <path d="M2 10h1" stroke="#E8654A" strokeWidth="1.5" opacity="0.5" />
    <path d="M5 6v8" stroke="#E8654A" strokeWidth="1.5" opacity="0.65" />
    <path d="M8 4v12" stroke="#E8654A" strokeWidth="1.5" />
    <path d="M11 7v6" stroke="#D94E7A" strokeWidth="1.5" opacity="0.8" />
    <path d="M14 5v10" stroke="#D94E7A" strokeWidth="1.5" opacity="0.7" />
    <path d="M17 8v4" stroke="#D94E7A" strokeWidth="1.5" opacity="0.5" />
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
      background: '#F8F6F3',
      border: '1px solid #E8E4DE',
      borderRadius: '14px',
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
          color: '#E8654A',
          letterSpacing: '0.01em',
          fontFamily: '"Space Grotesk", sans-serif',
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
          height: '44px',
          borderRadius: '10px',
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
            background: '#FFFFFF',
            border: '1px solid #E8E4DE',
            borderRadius: '10px',
            color: '#6B635A',
            cursor: 'pointer',
            fontSize: '13px',
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            transition: 'all 0.15s ease',
          }}
          onClick={handleDownload}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#E8654A';
            e.currentTarget.style.color = '#E8654A';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#E8E4DE';
            e.currentTarget.style.color = '#6B635A';
          }}
        >
          <DownloadIcon />
          Download WAV
        </button>
      </div>
    </div>
  );
}
