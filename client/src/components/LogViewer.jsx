import React, { useEffect, useRef, useState } from 'react';

const TerminalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#9B938A" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
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
      background: '#1A1614',
      border: '1px solid #2A2520',
      borderRadius: '12px',
      overflow: 'hidden',
    }}>
      {/* Terminal header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 14px',
        background: '#221F1C',
        borderBottom: '1px solid #2A2520',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <div style={{ display: 'flex', gap: '5px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#E8654A', opacity: 0.8 }} />
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#D49A2A', opacity: 0.8 }} />
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2D9D6F', opacity: 0.8 }} />
          </div>
          <span style={{
            fontSize: '12px',
            color: '#6B635A',
            fontWeight: 500,
            fontFamily: '"JetBrains Mono", "Consolas", monospace',
            marginLeft: '4px',
          }}>
            output
          </span>
          {logs.length > 0 && (
            <span style={{
              fontSize: '10px',
              color: '#5A524A',
              background: '#2A2520',
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
            background: autoScroll ? 'rgba(232, 101, 74, 0.12)' : '#2A2520',
            border: `1px solid ${autoScroll ? 'rgba(232, 101, 74, 0.2)' : '#3A3530'}`,
            color: autoScroll ? '#E8654A' : '#6B635A',
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
            color: log.stream === 'stderr' ? '#E8654A' : '#A09890',
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
            color: '#3A3530',
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
