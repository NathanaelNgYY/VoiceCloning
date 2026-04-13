import React, { useEffect, useState } from 'react';
import { Bookmark, Pencil, Save, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export default function ReferencePresetLibrary({
  presets,
  activePresetId,
  onApply,
  onRename,
  onDelete,
}) {
  const [editingId, setEditingId] = useState('');
  const [draftName, setDraftName] = useState('');

  useEffect(() => {
    if (editingId && !presets.some((preset) => preset.id === editingId)) {
      setEditingId('');
      setDraftName('');
    }
  }, [editingId, presets]);

  function startRename(preset) {
    setEditingId(preset.id);
    setDraftName(preset.name);
  }

  function cancelRename() {
    setEditingId('');
    setDraftName('');
  }

  function commitRename() {
    const nextName = draftName.trim();
    if (!editingId || !nextName) return;
    onRename(editingId, nextName);
    cancelRename();
  }

  return (
    <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(135deg,rgba(248,250,252,0.94),rgba(255,255,255,0.9))] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Saved Reference Sets</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Save a reference combination you like, then bring it back later with one click when you want the same voice setup again.
          </p>
        </div>
        <Badge variant="outline" className="bg-white text-[10px] uppercase tracking-[0.18em]">
          {presets.length} saved
        </Badge>
      </div>

      {presets.length === 0 ? (
        <div className="mt-4 rounded-[20px] border border-dashed border-slate-200 bg-white/75 px-4 py-5 text-sm text-slate-500">
          Confirm a reference selection to create your first reusable set.
        </div>
      ) : (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {presets.map((preset) => {
            const isActive = preset.id === activePresetId;
            const isEditing = preset.id === editingId;

            return (
              <div
                key={preset.id}
                className={cn(
                  'rounded-[20px] border p-4 transition-all',
                  isActive
                    ? 'border-sky-200 bg-sky-50/80 shadow-[0_18px_40px_-28px_rgba(14,165,233,0.55)]'
                    : 'border-slate-200 bg-white/90'
                  )}
              >
                <div className="flex items-start gap-3">
                  {isEditing ? (
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                          <Bookmark size={16} />
                        </div>
                        <Input
                          value={draftName}
                          onChange={(event) => setDraftName(event.target.value)}
                          className="h-10 rounded-2xl border-slate-200 bg-white"
                          autoFocus
                        />
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {preset.voiceLabel && (
                          <Badge variant="outline" className="bg-white text-[10px] uppercase tracking-[0.18em]">
                            {preset.voiceLabel}
                          </Badge>
                        )}
                        <Badge variant="outline" className="bg-white text-[10px] uppercase tracking-[0.18em]">
                          {preset.aux.length} aux
                        </Badge>
                      </div>

                      <p className="mt-3 truncate font-mono text-xs text-slate-500">{preset.primary.name}</p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onApply(preset)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl',
                            isActive ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'
                          )}
                        >
                          <Bookmark size={16} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900">{preset.name}</p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {preset.voiceLabel && (
                          <Badge variant="outline" className="bg-white text-[10px] uppercase tracking-[0.18em]">
                            {preset.voiceLabel}
                          </Badge>
                        )}
                        <Badge variant="outline" className="bg-white text-[10px] uppercase tracking-[0.18em]">
                          {preset.aux.length} aux
                        </Badge>
                        {isActive && (
                          <Badge className="text-[10px] uppercase tracking-[0.18em]">Current</Badge>
                        )}
                      </div>

                      <p className="mt-3 truncate font-mono text-xs text-slate-500">{preset.primary.name}</p>
                    </button>
                  )}

                  <div className="flex shrink-0 gap-1">
                    {isEditing ? (
                      <>
                        <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl border-slate-200" onClick={commitRename}>
                          <Save size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={cancelRename}>
                          <X size={14} />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={() => startRename(preset)}>
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 rounded-xl text-slate-400 hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => onDelete(preset.id)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
