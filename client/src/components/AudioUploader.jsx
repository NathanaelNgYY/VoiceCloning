import React, { useState, useRef } from 'react';
import { Upload, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

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
      {/* Drop zone */}
      <div
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-[26px] border-2 border-dashed px-8 py-12 text-center transition-all",
          dragOver
            ? "border-primary/50 bg-primary/5 shadow-[0_20px_40px_-28px_rgba(14,165,233,0.75)]"
            : "border-border bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(240,249,255,0.7))] hover:border-primary/30 hover:bg-muted/50",
          disabled && "cursor-not-allowed opacity-40"
        )}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <Upload
          className={cn(
            "mb-3 transition-colors",
            dragOver ? "text-primary" : "text-muted-foreground"
          )}
          size={30}
        />
        <p className={cn(
          "text-sm font-semibold transition-colors",
          dragOver ? "text-primary" : "text-muted-foreground"
        )}>
          {dragOver ? 'Drop files here' : 'Drop audio files, or click to browse'}
        </p>
        <p className="mt-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
          WAV, MP3, OGG, FLAC, M4A
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          onChange={handleSelect}
          className="hidden"
          disabled={disabled}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-4 animate-fade-in">
          {/* File count header */}
          <div className="mb-3 flex items-center justify-between border-b border-slate-200/80 pb-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="rounded-full text-xs">
                {files.length} file{files.length !== 1 ? 's' : ''}
              </Badge>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {formatSize(totalSize)}
            </span>
          </div>

          {/* File items */}
          <ScrollArea className="max-h-[220px] rounded-[22px] border border-slate-200 bg-white">
            <div className="flex flex-col divide-y divide-slate-200/80">
              {files.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between px-4 py-3 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-5 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="truncate text-sm font-medium text-foreground">
                      {f.name}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {formatSize(f.size || 0)}
                    </span>
                  </div>
                  <button
                    className={cn(
                      "ml-2 shrink-0 rounded-xl p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
                      disabled && "cursor-not-allowed"
                    )}
                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    disabled={disabled}
                    title="Remove file"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
