import React, { useState, useRef } from 'react';

const ACCEPT = '.wav,.mp3,.ogg,.flac,.m4a';

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

export default function AudioUploader({ files, onFilesChange, disabled }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const dropped = Array.from(e.dataTransfer.files).filter(f =>
      ACCEPT.split(',').some(ext => f.name.toLowerCase().endsWith(ext))
    );
    onFilesChange([...files, ...dropped]);
  }

  function handleSelect(e) {
    const selected = Array.from(e.target.files);
    onFilesChange([...files, ...selected]);
    e.target.value = '';
  }

  function removeFile(index) {
    onFilesChange(files.filter((_, i) => i !== index));
  }

  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);

  return (
    <div>
      {/* Drop zone — brutalist dashed border, oversized type */}
      <div
        style={{
          border: dragOver ? '2px solid var(--text-primary)' : '2px dashed var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          padding: '48px 32px',
          textAlign: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s ease',
          background: dragOver ? 'var(--bg-surface)' : 'transparent',
          opacity: disabled ? 0.4 : 1,
        }}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <p style={{
          fontSize: '20px',
          fontFamily: 'var(--font-display)',
          color: dragOver ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontWeight: 400,
          transition: 'color 0.15s ease',
          fontStyle: 'italic',
        }}>
          {dragOver ? 'Drop files here' : 'Drop audio files, or click to browse'}
        </p>
        <p style={{
          fontSize: '11px',
          color: 'var(--text-muted)',
          marginTop: '10px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          WAV, MP3, OGG, FLAC, M4A
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          onChange={handleSelect}
          style={{ display: 'none' }}
          disabled={disabled}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div style={{
          marginTop: '16px',
          animation: 'fade-in 0.3s ease',
        }}>
          {/* File count header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
            paddingBottom: '8px',
            borderBottom: '1px solid var(--border-hairline)',
          }}>
            <span style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              fontWeight: 500,
              letterSpacing: '0.02em',
            }}>
              {files.length} file{files.length !== 1 ? 's' : ''}
            </span>
            <span style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              letterSpacing: '0.02em',
            }}>
              {formatSize(totalSize)}
            </span>
          </div>

          {/* File items */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0',
            maxHeight: '200px',
            overflowY: 'auto',
          }}>
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: '1px solid var(--border-hairline)',
                transition: 'background 0.1s ease',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <span style={{
                    fontSize: '10px',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    width: '20px',
                    textAlign: 'right',
                    flexShrink: 0,
                  }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span style={{
                    fontSize: '13px',
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {f.name}
                  </span>
                  <span style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    flexShrink: 0,
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {formatSize(f.size || 0)}
                  </span>
                </div>
                <button
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    padding: '2px 6px',
                    lineHeight: 1,
                    transition: 'color 0.1s ease',
                    fontFamily: 'var(--font-body)',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                  }}
                  onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                  disabled={disabled}
                  title="Remove file"
                  onMouseEnter={(e) => { if (!disabled) e.target.style.color = 'var(--accent)'; }}
                  onMouseLeave={(e) => { e.target.style.color = 'var(--text-muted)'; }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
