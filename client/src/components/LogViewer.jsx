import React, { useEffect, useRef, useState } from 'react';

const TerminalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#6b6b70" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 4.5l3 2.5-3 2.5" />
    <path d="M8 10h3" />
  </svg>
);

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
      background: '#0e0e12',
      border: '1px solid #1e1e24',
      borderRadius: '10px',
      overflow: 'hidden',
    }}>
      {/* Terminal header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 14px',
        background: '#141419',
        borderBottom: '1px solid #1e1e24',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <TerminalIcon />
          <span style={{
            fontSize: '12px',
            color: '#5a5a60',
            fontWeight: 500,
            fontFamily: '"JetBrains Mono", "Consolas", monospace',
          }}>
            output
          </span>
          {logs.length > 0 && (
            <span style={{
              fontSize: '10px',
              color: '#4a4a50',
              background: '#1a1a20',
              padding: '1px 7px',
              borderRadius: '10px',
              fontFamily: '"JetBrains Mono", "Consolas", monospace',
            }}>
              {logs.length}
            </span>
          )}
        </div>
        <button
          style={{
            background: autoScroll ? 'rgba(212, 160, 83, 0.1)' : '#18181d',
            border: `1px solid ${autoScroll ? 'rgba(212, 160, 83, 0.2)' : '#2a2a30'}`,
            color: autoScroll ? '#d4a053' : '#5a5a60',
            cursor: 'pointer',
            padding: '3px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            transition: 'all 0.15s ease',
          }}
          onClick={() => setAutoScroll(!autoScroll)}
        >
          Auto-scroll {autoScroll ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Log content */}
      <div
        ref={contentRef}
        style={{
          height: '300px',
          overflowY: 'auto',
          padding: '12px 16px',
          fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
          fontSize: '12px',
          lineHeight: '1.7',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
        onScroll={handleScroll}
      >
        {logs.map((log, i) => (
          <div key={i} style={{
            color: log.stream === 'stderr' ? '#d4a053' : '#8a8a90',
            padding: '1px 0',
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
            color: '#2a2a30',
            fontSize: '13px',
            gap: '8px',
          }}>
            <TerminalIcon />
            <span>Waiting for output...</span>
          </div>
        )}
      </div>
    </div>
  );
}
