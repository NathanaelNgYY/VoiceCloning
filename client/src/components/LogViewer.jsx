import React, { useEffect, useRef, useState } from 'react';

export default function LogViewer({ logs }) {
  const contentRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function handleScroll() {
    if (!contentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(atBottom);
  }

  return (
    <div style={{
      background: '#1A1A1A',
      border: '1px solid #2A2A2A',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {/* Terminal header — minimal */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 16px',
        borderBottom: '1px solid #2A2A2A',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <span style={{
            fontSize: '11px',
            color: '#666',
            fontWeight: 500,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}>
            Output
          </span>
          {logs.length > 0 && (
            <span style={{
              fontSize: '10px',
              color: '#555',
              fontFamily: 'var(--font-mono)',
            }}>
              {logs.length} lines
            </span>
          )}
        </div>
        <button
          style={{
            background: autoScroll ? 'rgba(230, 57, 70, 0.1)' : '#2A2A2A',
            border: 'none',
            color: autoScroll ? '#E63946' : '#555',
            cursor: 'pointer',
            padding: '3px 10px',
            borderRadius: '2px',
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
            fontWeight: 500,
            transition: 'all 0.1s ease',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
          onClick={() => setAutoScroll(!autoScroll)}
        >
          Auto-scroll {autoScroll ? 'on' : 'off'}
        </button>
      </div>

      {/* Log content */}
      <div
        ref={contentRef}
        style={{
          height: '300px',
          overflowY: 'auto',
          padding: '14px 18px',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          lineHeight: '1.8',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
        onScroll={handleScroll}
      >
        {logs.map((log, i) => (
          <div key={i} style={{
            color: log.stream === 'stderr' ? '#E63946' : '#888',
            padding: '0',
          }}>
            {log.data}
          </div>
        ))}
        {logs.length === 0 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#333',
            fontSize: '13px',
            gap: '8px',
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
          }}>
            <span>Waiting for output...</span>
          </div>
        )}
      </div>
    </div>
  );
}
