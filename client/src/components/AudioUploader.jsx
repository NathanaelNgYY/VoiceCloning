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
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-8 py-12 text-center transition-all",
          dragOver
            ? "border-primary/50 bg-primary/5"
            : "border-border hover:border-primary/30 hover:bg-muted/50",
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
          size={28}
        />
        <p className={cn(
          "text-sm font-medium transition-colors",
          dragOver ? "text-primary" : "text-muted-foreground"
        )}>
          {dragOver ? 'Drop files here' : 'Drop audio files, or click to browse'}
        </p>
        <p className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">
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
          <div className="mb-2.5 flex items-center justify-between border-b pb-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {files.length} file{files.length !== 1 ? 's' : ''}
              </Badge>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {formatSize(totalSize)}
            </span>
          </div>

          {/* File items */}
          <ScrollArea className="max-h-[200px]">
            <div className="flex flex-col">
              {files.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between border-b py-2.5 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-5 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="truncate text-sm text-foreground">
                      {f.name}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {formatSize(f.size || 0)}
                    </span>
                  </div>
                  <button
                    className={cn(
                      "ml-2 shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
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
