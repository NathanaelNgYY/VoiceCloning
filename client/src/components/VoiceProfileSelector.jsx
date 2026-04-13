import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function ModelSelect({ label, value, onChange, options, disabled, accentClass, badgeText }) {
  return (
    <div className={`rounded-2xl border p-4 ${accentClass}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.24em]">{label}</span>
        <Badge variant="outline" className="bg-white text-[10px] uppercase tracking-[0.18em]">
          {badgeText}
        </Badge>
      </div>

      <Select value={value || undefined} onValueChange={onChange} disabled={disabled || options.length === 0}>
        <SelectTrigger className="mt-3 h-11 rounded-2xl border-white/80 bg-white/90 shadow-sm">
          <SelectValue placeholder={`Choose ${label} model...`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((candidate) => (
            <SelectItem key={candidate.model.path} value={candidate.model.path}>
              {candidate.model.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function VoiceProfileSelector({
  profiles,
  value,
  onChange,
  disabled,
  selectedProfile,
  selectedGPTPath,
  selectedSoVITSPath,
  onGPTChange,
  onSoVITSChange,
  selectedGPTCandidate,
  selectedSoVITSCandidate,
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.95fr)]">
      <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/80 p-5">
        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            Voice Person
          </Label>
          <Badge variant="outline" className="text-[10px] uppercase tracking-[0.18em]">
            Highest by default
          </Badge>
        </div>

        <Select value={value || undefined} onValueChange={onChange} disabled={disabled || profiles.length === 0}>
          <SelectTrigger className="mt-3 h-12 rounded-2xl border-slate-200 bg-white shadow-sm">
            <SelectValue placeholder="Choose a person..." />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((profile) => (
              <SelectItem key={profile.key} value={profile.key} disabled={!profile.complete}>
                {profile.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p className="mt-3 text-sm leading-6 text-slate-500">
          Pick the speaker first, then optionally override the GPT or SoVITS checkpoint if you want something other than the latest epoch.
        </p>
      </div>

      <div className="rounded-[22px] border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="space-y-4">
          <ModelSelect
            label="GPT"
            value={selectedGPTPath}
            onChange={onGPTChange}
            options={selectedProfile?.gptCandidates || []}
            disabled={disabled || !selectedProfile}
            badgeText={selectedGPTCandidate?.epoch >= 0 ? `e${selectedGPTCandidate.epoch}` : 'Missing'}
            accentClass="border-sky-100 bg-sky-50/75 text-sky-700"
          />

          <ModelSelect
            label="SoVITS"
            value={selectedSoVITSPath}
            onChange={onSoVITSChange}
            options={selectedProfile?.sovitsCandidates || []}
            disabled={disabled || !selectedProfile}
            badgeText={selectedSoVITSCandidate?.epoch >= 0 ? `e${selectedSoVITSCandidate.epoch}` : 'Missing'}
            accentClass="border-emerald-100 bg-emerald-50/75 text-emerald-700"
          />
        </div>
      </div>
    </div>
  );
}
