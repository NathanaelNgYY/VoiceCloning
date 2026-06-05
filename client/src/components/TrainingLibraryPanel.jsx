import { useMemo, useRef } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  getTrainingLibraryOverflowHint,
  getTrainingLibraryScrollAreaClass,
} from '@/lib/trainingSource';
import { cn } from '@/lib/utils';
import { HardDrive, Pencil, Trash2, Upload } from 'lucide-react';

function formatSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatUpdatedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export default function TrainingLibraryPanel({
  files = [],
  selectedIds = [],
  loading = false,
  uploadBusy = false,
  replaceBusyId = '',
  deleteBusyId = '',
  disabled = false,
  storageMode = 'local',
  onUploadFiles,
  onToggleSelect,
  onReplaceFile,
  onDeleteFile,
}) {
  const uploadInputRef = useRef(null);
  const replaceInputRefs = useRef({});
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const storageEnabled = storageMode === 's3';
  const overflowHint = getTrainingLibraryOverflowHint(files.length);
  const scrollAreaClass = getTrainingLibraryScrollAreaClass(files.length);

  function handleUploadSelection(event) {
    const nextFiles = Array.from(event.target.files || []);
    event.target.value = '';
    if (nextFiles.length > 0) {
      onUploadFiles(nextFiles);
    }
  }

  function handleReplaceSelection(fileId, event) {
    const nextFile = event.target.files?.[0] || null;
    event.target.value = '';
    if (nextFile) {
      onReplaceFile(fileId, nextFile);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_12px_40px_-28px_rgba(15,23,42,0.35)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Shared Storage</p>
          <p className="mt-1 text-sm text-slate-500">
            Upload reusable audio to S3, then choose which clips to train with.
          </p>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
          {selectedIds.length} selected
        </span>
      </div>

      <div
        className={cn(
          'mt-4 rounded-2xl border border-dashed px-4 py-5 text-center transition-colors',
          storageEnabled && !disabled ? 'cursor-pointer border-slate-200 hover:border-primary/40 hover:bg-primary/[0.025]' : 'border-slate-200 bg-slate-50',
          disabled && 'cursor-not-allowed opacity-60'
        )}
        onClick={() => {
          if (storageEnabled && !disabled) {
            uploadInputRef.current?.click();
          }
        }}
      >
        <Upload size={18} className="mx-auto mb-2 text-slate-400" />
        <p className="text-sm font-medium text-slate-700">
          {uploadBusy ? 'Uploading to shared storage...' : 'Upload to shared storage'}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {storageEnabled ? 'This does not auto-select clips for the current run.' : 'Shared storage appears only when S3 mode is enabled.'}
        </p>
        <input
          ref={uploadInputRef}
          type="file"
          accept=".wav,.mp3,.ogg,.flac,.m4a,.webm,.mp4"
          multiple
          disabled={disabled || !storageEnabled || uploadBusy}
          className="hidden"
          onChange={handleUploadSelection}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 text-xs text-slate-500">
          <span className="font-medium text-slate-600">Stored audio</span>
          <span>{loading ? 'Loading...' : `${files.length} file${files.length === 1 ? '' : 's'}`}</span>
        </div>
        {overflowHint && storageEnabled && !loading && (
          <div className="border-b border-slate-200 bg-white/70 px-4 py-2 text-[11px] text-slate-500">
            {overflowHint}
          </div>
        )}
        <ScrollArea className={scrollAreaClass}>
          <div className="p-2 pr-3">
            {!storageEnabled ? (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
                Shared storage is available only when the backend storage mode is `s3`.
              </div>
            ) : loading ? (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
                Loading shared storage files...
              </div>
            ) : files.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
                No shared audio uploaded yet.
              </div>
            ) : (
              files.map((file) => {
                const isSelected = selectedIdSet.has(file.id);
                const isReplacing = replaceBusyId === file.id;
                const isDeleting = deleteBusyId === file.id;

                return (
                  <div
                    key={file.id}
                    className={cn(
                      'mb-2 rounded-xl border px-3 py-2.5 last:mb-0',
                      isSelected ? 'border-primary/30 bg-primary/[0.04]' : 'border-slate-200 bg-white'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={isSelected}
                        disabled={disabled}
                        onCheckedChange={(checked) => onToggleSelect(file.id, Boolean(checked))}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <HardDrive size={14} className="shrink-0 text-slate-400" />
                          <span className="truncate text-sm font-medium text-slate-800">{file.filename}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatSize(file.size)}{formatUpdatedAt(file.updatedAt) ? ` - Updated ${formatUpdatedAt(file.updatedAt)}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-xl border-slate-200 bg-white shadow-none"
                        disabled={disabled || isReplacing || isDeleting}
                        onClick={() => replaceInputRefs.current[file.id]?.click()}
                      >
                        <Pencil size={13} />
                        {isReplacing ? 'Replacing...' : 'Replace'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-xl border-red-200 bg-white text-red-600 shadow-none hover:bg-red-50 hover:text-red-700"
                        disabled={disabled || isReplacing || isDeleting}
                        onClick={() => onDeleteFile(file.id)}
                      >
                        <Trash2 size={13} />
                        {isDeleting ? 'Deleting...' : 'Delete'}
                      </Button>
                      <input
                        ref={(node) => {
                          replaceInputRefs.current[file.id] = node;
                        }}
                        type="file"
                        accept=".wav,.mp3,.ogg,.flac,.m4a,.webm,.mp4"
                        className="hidden"
                        disabled={disabled || isReplacing || isDeleting}
                        onChange={(event) => handleReplaceSelection(file.id, event)}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
