import React, { useState, useEffect } from 'react';
import WordTimestampPlayer from '../components/WordTimestampPlayer.jsx';
import { getInferenceStatus, getModels, selectModels, getTrainingAudioFiles, synthesize } from '../services/api.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import Spinner from '../components/Spinner.jsx';
import { cn } from '@/lib/utils';

// Standalone TTS test page for verifying word-timestamp highlighting.
// Uses POST /inference (direct, no SSE) to avoid CloudFront SSE routing requirements.

export default function TtsTestPage() {
  const [status, setStatus] = useState(null);
  const [models, setModels] = useState({ sovits: [], gpt: [] });
  const [selectedSovits, setSelectedSovits] = useState('');
  const [selectedGpt, setSelectedGpt] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState(null);

  const [expName, setExpName] = useState('');
  const [audioFiles, setAudioFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedRef, setSelectedRef] = useState('');
  const [promptText, setPromptText] = useState('');

  const [text, setText] = useState('');
  const [textLang, setTextLang] = useState('en');
  const [synthesizing, setSynthesizing] = useState(false);
  const [result, setResult] = useState(null);
  const [synthError, setSynthError] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [statusRes, modelsRes] = await Promise.all([getInferenceStatus(), getModels()]);
        setStatus(statusRes.data);
        const raw = modelsRes.data;
        setModels({ sovits: raw.sovits || [], gpt: raw.gpt || [] });
        if (raw.sovits?.length) setSelectedSovits(raw.sovits[0].path || raw.sovits[0]);
        if (raw.gpt?.length) setSelectedGpt(raw.gpt[0].path || raw.gpt[0]);
      } catch (err) {
        setStatus({ ready: false, error: err.message });
      }
    }
    load();
  }, []);

  async function handleLoadModels() {
    if (!selectedSovits || !selectedGpt) return;
    setLoadingModels(true);
    setModelError(null);
    try {
      await selectModels(selectedGpt, selectedSovits);
      const res = await getInferenceStatus();
      setStatus(res.data);
    } catch (err) {
      setModelError(err.response?.data?.error || err.message);
    } finally {
      setLoadingModels(false);
    }
  }

  async function handleLoadFiles() {
    if (!expName.trim()) return;
    setLoadingFiles(true);
    try {
      const res = await getTrainingAudioFiles(expName.trim());
      setAudioFiles(res.data || []);
      if (res.data?.length) setSelectedRef(res.data[0].path);
    } catch (err) {
      setAudioFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }

  async function handleSynthesize() {
    if (!text.trim()) return;
    if (!selectedRef) return;
    setSynthesizing(true);
    setSynthError(null);
    setResult(null);
    try {
      const { blob, wordTimestamps } = await synthesize({
        text: text.trim(),
        text_lang: textLang,
        ref_audio_path: selectedRef,
        prompt_text: promptText,
        prompt_lang: textLang,
        text_split_method: 'cut5',
      });
      setResult({ blob, wordTimestamps });
    } catch (err) {
      setSynthError(err.response?.data?.error || err.message);
    } finally {
      setSynthesizing(false);
    }
  }

  const modelReady = status?.ready === true;
  const sovitsItems = models.sovits.map((m) => ({ label: m.name || m.path || m, value: m.path || m }));
  const gptItems = models.gpt.map((m) => ({ label: m.name || m.path || m, value: m.path || m }));

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">TTS Timestamp Test</h1>
        <p className="mt-1 text-sm text-slate-500">
          Direct synthesis (no SSE) — for testing word-highlight timestamps locally against the EC2.
        </p>
      </div>

      {/* Model Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Model Status</CardTitle>
              <CardDescription>Load a voice model on the inference worker</CardDescription>
            </div>
            <Badge className={cn('text-xs', modelReady ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>
              {status === null ? 'Checking…' : modelReady ? 'Ready' : 'No model loaded'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.error && !modelReady && (
            <p className="text-sm text-red-600">{status.error}</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>SoVITS weights</Label>
              <Select value={selectedSovits} onValueChange={setSelectedSovits} disabled={!sovitsItems.length}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder={sovitsItems.length ? 'Select…' : 'No weights found'} />
                </SelectTrigger>
                <SelectContent>
                  {sovitsItems.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>GPT weights</Label>
              <Select value={selectedGpt} onValueChange={setSelectedGpt} disabled={!gptItems.length}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder={gptItems.length ? 'Select…' : 'No weights found'} />
                </SelectTrigger>
                <SelectContent>
                  {gptItems.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {modelError && <p className="text-sm text-red-600">{modelError}</p>}
          <Button
            size="sm"
            onClick={handleLoadModels}
            disabled={loadingModels || !selectedSovits || !selectedGpt}
          >
            {loadingModels ? <><Spinner size={14} className="mr-1.5" />Loading…</> : 'Load model'}
          </Button>
        </CardContent>
      </Card>

      {/* Reference Audio */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reference Audio</CardTitle>
          <CardDescription>Pick a clip from a training experiment for voice reference</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Experiment name (e.g. my_voice)"
              value={expName}
              onChange={(e) => setExpName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoadFiles()}
              className="text-sm"
            />
            <Button size="sm" variant="outline" onClick={handleLoadFiles} disabled={loadingFiles || !expName.trim()}>
              {loadingFiles ? <Spinner size={14} /> : 'Load'}
            </Button>
          </div>
          {audioFiles.length > 0 && (
            <div className="space-y-1.5">
              <Label>Reference clip</Label>
              <Select value={selectedRef} onValueChange={setSelectedRef}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Select clip…" />
                </SelectTrigger>
                <SelectContent>
                  {audioFiles.map((f) => (
                    <SelectItem key={f.path} value={f.path}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Reference text <span className="text-slate-400">(optional)</span></Label>
            <Input
              placeholder="Transcript of the reference clip"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              className="text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Synthesis */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Synthesize</CardTitle>
          <CardDescription>Generate speech and verify word timestamps</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="w-28 space-y-1.5">
              <Label>Language</Label>
              <Select value={textLang} onValueChange={setTextLang}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[['en', 'English'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['auto', 'Auto']].map(
                    ([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Text to synthesize</Label>
            <Textarea
              placeholder="Enter text here…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="text-sm"
            />
          </div>
          {synthError && <p className="text-sm text-red-600">{synthError}</p>}
          <Button
            onClick={handleSynthesize}
            disabled={synthesizing || !text.trim() || !selectedRef || !modelReady}
          >
            {synthesizing ? <><Spinner size={14} className="mr-1.5" />Synthesizing…</> : 'Generate'}
          </Button>
          {!modelReady && !synthesizing && (
            <p className="text-xs text-amber-600">Load a model above before generating.</p>
          )}
          {result && (
            <div className="mt-2">
              {result.wordTimestamps === null && (
                <p className="mb-2 text-xs text-amber-600">
                  Word timestamps unavailable (alignment failed or timed out) — showing plain audio.
                </p>
              )}
              <WordTimestampPlayer
                audioBlob={result.blob}
                wordTimestamps={result.wordTimestamps}
                transcript={text}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
