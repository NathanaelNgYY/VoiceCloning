import React, { useState, useEffect } from 'react';

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
      borderTop: '1px solid var(--border-hairline)',
      paddingTop: '20px',
      animation: 'slide-in 0.4s ease',
    }}>
      {/* Label */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '16px',
      }}>
        <div style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'var(--text-primary)',
        }} />
        <span style={{
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--text-primary)',
          letterSpacing: '0.02em',
          fontFamily: 'var(--font-body)',
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
          height: '42px',
          borderRadius: 'var(--radius-sm)',
        }}
      />

      {/* Download */}
      <div style={{ marginTop: '14px' }}>
        <button
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '9px 20px',
            background: 'transparent',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: '12px',
            fontFamily: 'var(--font-body)',
            fontWeight: 500,
            transition: 'all 0.15s ease',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
          onClick={handleDownload}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--text-primary)';
            e.currentTarget.style.color = 'var(--bg-elevated)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2v6M4 6l2 2 2-2" />
            <path d="M2 9v1.5h8V9" />
          </svg>
          Download WAV
        </button>
      </div>
    </div>
  );
}
