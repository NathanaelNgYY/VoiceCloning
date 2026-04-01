import React, { useState, useRef } from 'react';

const ACCEPT = '.wav,.mp3,.ogg,.flac,.m4a';

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

const UploadIcon = () => (
  <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="#6b6b70" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 24V8" />
    <path d="M12 14l6-6 6 6" />
    <path d="M6 24v4a2 2 0 002 2h20a2 2 0 002-2v-4" />
  </svg>
);

const MusicIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#d4a053" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 11.5V3.5L12 2v8" />
    <circle cx="3.5" cy="11.5" r="1.5" />
    <circle cx="10.5" cy="10" r="1.5" />
  </svg>
);

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
      {/* Drop zone */}
      <div
        style={{
          border: dragOver ? '2px solid #d4a053' : '2px dashed #2a2a30',
          borderRadius: '12px',
          padding: '36px 24px',
          textAlign: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.25s ease',
          background: dragOver ? 'rgba(212, 160, 83, 0.04)' : '#111115',
          opacity: disabled ? 0.5 : 1,
        }}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '10px',
        }}>
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '14px',
            background: dragOver ? 'rgba(212, 160, 83, 0.1)' : '#18181d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.25s ease',
          }}>
            <UploadIcon />
          </div>
          <div>
            <p style={{
              fontSize: '14px',
              color: dragOver ? '#d4a053' : '#8a8a90',
              fontWeight: 500,
              transition: 'color 0.2s ease',
            }}>
              {dragOver ? 'Drop audio files here' : 'Drag & drop audio files, or click to browse'}
            </p>
            <p style={{
              fontSize: '12px',
              color: '#4a4a50',
              marginTop: '4px',
            }}>
              WAV, MP3, OGG, FLAC, M4A
            </p>
          </div>
        </div>
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
          marginTop: '12px',
          animation: 'fade-in 0.3s ease',
        }}>
          {/* File count header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
            padding: '0 4px',
          }}>
            <span style={{
              fontSize: '12px',
              color: '#6b6b70',
              fontWeight: 500,
            }}>
              {files.length} file{files.length !== 1 ? 's' : ''} selected
            </span>
            <span style={{
              fontSize: '11px',
              color: '#4a4a50',
            }}>
              {formatSize(totalSize)} total
            </span>
          </div>

          {/* File items */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            maxHeight: '180px',
            overflowY: 'auto',
            paddingRight: '4px',
          }}>
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                background: '#14141a',
                borderRadius: '8px',
                border: '1px solid #1e1e24',
                transition: 'background 0.15s ease',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <MusicIcon />
                  <span style={{
                    fontSize: '13px',
                    color: '#b0ada6',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {f.name}
                  </span>
                  <span style={{ fontSize: '11px', color: '#4a4a50', flexShrink: 0 }}>
                    {formatSize(f.size || 0)}
                  </span>
                </div>
                <button
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#5a5a60',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    fontSize: '18px',
                    padding: '0 2px',
                    lineHeight: 1,
                    transition: 'color 0.15s ease',
                    fontFamily: 'inherit',
                  }}
                  onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                  disabled={disabled}
                  title="Remove file"
                  onMouseEnter={(e) => { if (!disabled) e.target.style.color = '#e85750'; }}
                  onMouseLeave={(e) => { e.target.style.color = '#5a5a60'; }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
