import React, { useState, useEffect, useRef, useCallback } from 'react';
import ModelSelector from '../components/ModelSelector.jsx';
import AudioPlayer from '../components/AudioPlayer.jsx';
import RefAudioPlayer from '../components/RefAudioPlayer.jsx';
import Spinner from '../components/Spinner.jsx';
import { getModels, selectModels, uploadRefAudio, transcribeAudio, synthesize, getInferenceStatus, startGeneration, getGenerationResult, cancelGeneration, getTrainingAudioFiles, getTrainingAudioUrl } from '../services/api.js';
import { useInferenceSSE } from '../hooks/useInferenceSSE.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronRight, RefreshCw, Upload, Play, X, Check, Pencil, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function InferencePage() {
  const [gptModels, setGptModels] = useState([]);
  const [sovitsModels, setSovitsModels] = useState([]);
  const [selectedGPT, setSelectedGPT] = useState('');
  const [selectedSoVITS, setSelectedSoVITS] = useState('');
  const [serverReady, setServerReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modelError, setModelError] = useState(null);

  const [refAudioPath, setRefAudioPath] = useState('');
  const [refAudioFile, setRefAudioFile] = useState(null);
  const [refAudioUrl, setRefAudioUrl] = useState(null);
  const [promptText, setPromptText] = useState('');
  const [promptLang, setPromptLang] = useState('en');
  const [transcribing, setTranscribing] = useState(false);

  const [uploadedRefFiles, setUploadedRefFiles] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  const [trainingAudioFiles, setTrainingAudioFiles] = useState([]);
  const [auxRefAudios, setAuxRefAudios] = useState([]);
  const [loadingTrainingAudio, setLoadingTrainingAudio] = useState(false);
  const [refLocked, setRefLocked] = useState(false);

  const [text, setText] = useState('');
  const [textLang, setTextLang] = useState('en');

  const [showSettings, setShowSettings] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [topK, setTopK] = useState(5);
  const [topP, setTopP] = useState(1);
  const [temperature, setTemperature] = useState(1);
  const [repPenalty, setRepPenalty] = useState(1.35);

  const [audioBlob, setAudioBlob] = useState(null);
  const [inferError, setInferError] = useState(null);
  const sessionIdRef = useRef(null);

  const inference = useInferenceSSE();

  useEffect(() => {
    fetchModels();
    checkStatus();
  }, []);

  async function fetchModels() {
    try {
      const res = await getModels();
      setGptModels(res.data.gpt);
      setSovitsModels(res.data.sovits);
    } catch { /* ignore */ }
  }

  async function checkStatus() {
    try {
      const res = await getInferenceStatus();
      setServerReady(res.data.ready);
    } catch { /* ignore */ }
  }

  function extractExpName(modelPath) {
    if (!modelPath) return null;
    const basename = modelPath.replace(/\\/g, '/').split('/').pop();
    let match = basename.match(/^(.+?)_e\d+_s\d+\.pth$/);
    if (match) return match[1];
    match = basename.match(/^(.+?)-e\d+\.ckpt$/);
    if (match) return match[1];
    return null;
  }

  const currentExpName = extractExpName(selectedSoVITS) || extractExpName(selectedGPT);

  useEffect(() => {
    if (!currentExpName) return;
    setRefLocked(false);
    setLoadingTrainingAudio(true);
    getTrainingAudioFiles(currentExpName)
      .then(res => setTrainingAudioFiles(res.data.files || []))
      .catch(() => setTrainingAudioFiles([]))
      .finally(() => setLoadingTrainingAudio(false));
  }, [currentExpName]);

  function handleSelectTrainingAudio(file) {
    setRefAudioPath(file.path);
    setRefAudioFile({ name: file.filename });
    setRefAudioUrl(getTrainingAudioUrl(currentExpName, file.filename));
    setPromptText(file.transcript);
    if (file.lang) {
      const langMap = { ZH: 'zh', EN: 'en', JA: 'ja', KO: 'ko', zh: 'zh', en: 'en', ja: 'ja', ko: 'ko' };
      setPromptLang(langMap[file.lang] || 'en');
    }
    setAuxRefAudios(prev => prev.filter(f => f.filename !== file.filename));
  }

  function handleToggleAuxRef(file) {
    setAuxRefAudios(prev => {
      const exists = prev.some(f => f.filename === file.filename);
      if (exists) return prev.filter(f => f.filename !== file.filename);
      return [...prev, file];
    });
  }

  async function handleLoadModels() {
    if (!selectedGPT || !selectedSoVITS) {
      return alert('Select both GPT and SoVITS models');
    }
    setLoading(true);
    setModelError(null);
    try {
      await selectModels(selectedGPT, selectedSoVITS);
      setServerReady(true);
    } catch (err) {
      setModelError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefUpload(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setUploadingFiles(true);

    const newEntries = [];
    for (const file of files) {
      try {
        const res = await uploadRefAudio(file);
        newEntries.push({
          name: file.name,
          serverPath: res.data.path,
          localUrl: URL.createObjectURL(file),
        });
      } catch (err) {
        alert('Failed to upload ' + file.name + ': ' + (err.response?.data?.error || err.message));
      }
    }

    if (newEntries.length > 0) {
      setUploadedRefFiles(prev => {
        const merged = [...prev, ...newEntries];
        if (!refAudioPath || prev.length === 0) {
          setRefAudioFile({ name: merged[0].name });
          if (refAudioUrl) URL.revokeObjectURL(refAudioUrl);
          setRefAudioUrl(merged[0].localUrl);
          setRefAudioPath(merged[0].serverPath);
        }
        return merged;
      });
    }
    setUploadingFiles(false);
    e.target.value = '';
  }

  function handleSetUploadedPrimary(entry) {
    setRefAudioFile({ name: entry.name });
    if (refAudioUrl && !uploadedRefFiles.some(f => f.localUrl === refAudioUrl)) {
      URL.revokeObjectURL(refAudioUrl);
    }
    setRefAudioUrl(entry.localUrl);
    setRefAudioPath(entry.serverPath);
    setPromptText('');
  }

  function handleRemoveUploadedFile(entry) {
    setUploadedRefFiles(prev => {
      const remaining = prev.filter(f => f.serverPath !== entry.serverPath);
      if (entry.serverPath === refAudioPath) {
        if (remaining.length > 0) {
          setRefAudioFile({ name: remaining[0].name });
          setRefAudioUrl(remaining[0].localUrl);
          setRefAudioPath(remaining[0].serverPath);
        } else {
          setRefAudioFile(null);
          setRefAudioUrl(null);
          setRefAudioPath('');
        }
        setPromptText('');
      }
      URL.revokeObjectURL(entry.localUrl);
      return remaining;
    });
  }

  async function handleTranscribe() {
    if (!refAudioPath) return alert('Upload reference audio first');
    setTranscribing(true);
    try {
      const res = await transcribeAudio(refAudioPath, promptLang);
      setPromptText(res.data.text);
      if (res.data.language) setPromptLang(res.data.language);
    } catch (err) {
      alert('Transcription failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setTranscribing(false);
    }
  }

  async function handleGenerate() {
    if (!text.trim()) return alert('Enter text to synthesize');
    if (!refAudioPath) return alert('Select a reference audio first');
    if (!refLocked) return alert('Confirm your reference audio selection first');
    if (!serverReady) return alert('Load models first');

    setInferError(null);
    setAudioBlob(null);

    try {
      const res = await startGeneration({
        text,
        text_lang: textLang,
        ref_audio_path: refAudioPath,
        prompt_text: promptText,
        prompt_lang: promptLang,
        aux_ref_audio_paths: [
          ...auxRefAudios.map(f => f.path),
          ...uploadedRefFiles.filter(f => f.serverPath !== refAudioPath).map(f => f.serverPath),
        ],
        top_k: topK,
        top_p: topP,
        temperature,
        repetition_penalty: repPenalty,
        speed_factor: speed,
      });
      const { sessionId } = res.data;
      sessionIdRef.current = sessionId;
      inference.connect(sessionId);
    } catch (err) {
      setInferError(err.response?.data?.error || err.message);
    }
  }

  async function handleCancel() {
    if (sessionIdRef.current) {
      try {
        await cancelGeneration(sessionIdRef.current);
      } catch { /* ignore */ }
    }
  }

  useEffect(() => {
    if (inference.status === 'complete' && sessionIdRef.current) {
      getGenerationResult(sessionIdRef.current)
        .then(blob => setAudioBlob(blob))
        .catch(err => setInferError(err.message));
    }
    if (inference.status === 'error' || inference.status === 'cancelled') {
      setInferError(inference.error);
    }
  }, [inference.status]);

  const auxCount = auxRefAudios.length + uploadedRefFiles.filter(f => f.serverPath !== refAudioPath).length;

  return (
    <div className="animate-fade-in space-y-8">

      {/* 01 Models */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 text-xs font-semibold">
              1
            </Badge>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <CardTitle>Model Selection</CardTitle>
                <Badge variant={serverReady ? 'success' : 'outline'} className="text-[10px]">
                  <div className={cn(
                    "mr-1.5 h-1.5 w-1.5 rounded-full",
                    serverReady ? "bg-success-foreground" : "bg-muted-foreground"
                  )} />
                  {serverReady ? 'Ready' : 'Offline'}
                </Badge>
              </div>
              <CardDescription>Select and load your trained voice models</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <ModelSelector
              label="GPT Model"
              models={gptModels}
              value={selectedGPT}
              onChange={setSelectedGPT}
              disabled={loading}
            />
            <ModelSelector
              label="SoVITS Model"
              models={sovitsModels}
              value={selectedSoVITS}
              onChange={setSelectedSoVITS}
              disabled={loading}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleLoadModels} disabled={loading} variant="outline">
              {loading ? <Spinner size={14} /> : null}
              {loading ? 'Loading...' : 'Load Models'}
            </Button>

            <Button variant="ghost" size="sm" onClick={fetchModels}>
              <RefreshCw size={14} />
              Refresh
            </Button>

            {modelError && (
              <span className="border-l-2 border-destructive pl-3 text-sm text-destructive">
                {modelError}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 02 Reference Audio */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 text-xs font-semibold">
              2
            </Badge>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <CardTitle>Reference Audio</CardTitle>
                {refLocked && (
                  <Badge variant="success" className="text-[10px]">
                    <Check size={10} className="mr-1" />
                    Confirmed
                  </Badge>
                )}
              </div>
              <CardDescription>
                {refLocked ? 'Selection locked for generation' : 'Select a primary reference and optional auxiliary audio'}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {refLocked ? (
            /* Locked summary */
            <div>
              <div className="rounded-lg border bg-background p-4">
                <div className="mb-2 flex items-center gap-2.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span className="font-mono text-sm text-foreground">
                    {refAudioFile?.name || 'Unknown'}
                  </span>
                  <Badge variant="default" className="text-[10px]">Primary</Badge>
                </div>
                {promptText && (
                  <p className="ml-4 text-sm italic text-muted-foreground">
                    &ldquo;{promptText}&rdquo;
                  </p>
                )}
                {auxCount > 0 && (
                  <div className="ml-4 mt-1 text-sm text-muted-foreground">
                    + {auxCount} auxiliary reference{auxCount !== 1 ? 's' : ''}
                  </div>
                )}
              </div>

              {refAudioUrl && <RefAudioPlayer src={refAudioUrl} />}

              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setRefLocked(false)}
              >
                <Pencil size={12} />
                Edit Selection
              </Button>
            </div>
          ) : (
            /* Unlocked selection UI */
            <div>
              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                {/* Left: audio file list */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Audio Files</Label>
                    {auxCount > 0 && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {auxCount} aux
                      </Badge>
                    )}
                  </div>

                  {/* Training audio list */}
                  {loadingTrainingAudio ? (
                    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                      <Spinner /> Loading training audio...
                    </div>
                  ) : trainingAudioFiles.length > 0 ? (
                    <>
                      <div className="max-h-[280px] overflow-y-auto rounded-md border bg-background">
                        {trainingAudioFiles.map((file) => {
                          const isPrimary = file.path === refAudioPath;
                          const isAux = auxRefAudios.some(f => f.filename === file.filename);
                          return (
                            <div
                              key={file.filename}
                              className={cn(
                                "flex items-center gap-2.5 border-b px-3 py-2 transition-colors last:border-0",
                                isPrimary && "bg-primary/5"
                              )}
                            >
                              <input
                                type="radio"
                                name="primary-ref"
                                checked={isPrimary}
                                onChange={() => handleSelectTrainingAudio(file)}
                                title="Set as primary reference"
                                className="h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
                              />
                              <input
                                type="checkbox"
                                checked={isAux}
                                disabled={isPrimary}
                                onChange={() => handleToggleAuxRef(file)}
                                title={isPrimary ? 'Primary ref cannot also be auxiliary' : 'Toggle as auxiliary reference'}
                                className={cn(
                                  "h-4 w-4 shrink-0 accent-[hsl(var(--primary))]",
                                  isPrimary ? "cursor-not-allowed opacity-30" : "cursor-pointer"
                                )}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="break-all font-mono text-xs text-foreground">
                                  {file.filename}
                                </div>
                                {file.transcript && (
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                                    {file.transcript}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-1.5 flex gap-3 text-[10px] text-muted-foreground">
                        <span>Radio = primary ref</span>
                        <span>Checkbox = auxiliary ref</span>
                      </div>
                      {auxRefAudios.length > 0 && (
                        <button
                          onClick={() => setAuxRefAudios([])}
                          className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                        >
                          Clear auxiliary selections
                        </button>
                      )}
                    </>
                  ) : currentExpName ? (
                    <div className="rounded-md border bg-background p-4 text-center text-sm text-muted-foreground">
                      No training audio found for &ldquo;{currentExpName}&rdquo;
                    </div>
                  ) : (
                    <div className="rounded-md border bg-background p-4 text-center text-sm text-muted-foreground">
                      Load a model to browse its training audio
                    </div>
                  )}

                  {/* Upload custom files */}
                  <div className="mt-4">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Or Upload Custom Audio</Label>
                    <div className="mt-2 flex items-center gap-2.5 rounded-md border bg-background px-3 py-2.5">
                      <input
                        type="file"
                        accept=".wav,.mp3,.ogg,.flac"
                        multiple
                        onChange={handleRefUpload}
                        className="flex-1 text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20"
                      />
                      {uploadingFiles && <Spinner />}
                    </div>
                  </div>

                  {/* Uploaded file list */}
                  {uploadedRefFiles.length > 0 && (
                    <ScrollArea className="mt-2 max-h-[160px] rounded-md border bg-background">
                      {uploadedRefFiles.map((entry) => {
                        const isPrimary = entry.serverPath === refAudioPath;
                        return (
                          <div
                            key={entry.serverPath}
                            className={cn(
                              "flex items-center gap-2.5 border-b px-3 py-2 transition-colors last:border-0",
                              isPrimary && "bg-primary/5"
                            )}
                          >
                            <input
                              type="radio"
                              name="primary-ref"
                              checked={isPrimary}
                              onChange={() => handleSetUploadedPrimary(entry)}
                              title="Set as primary reference"
                              className="h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-mono text-xs text-foreground">
                                {entry.name}
                              </div>
                              <div className={cn(
                                "mt-0.5 text-[10px] uppercase tracking-wider",
                                isPrimary ? "font-semibold text-primary" : "text-muted-foreground"
                              )}>
                                {isPrimary ? 'Primary (uploaded)' : 'Auxiliary (uploaded)'}
                              </div>
                            </div>
                            <button
                              onClick={() => handleRemoveUploadedFile(entry)}
                              title="Remove"
                              className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </ScrollArea>
                  )}
                </div>

                {/* Right: transcript + language + player */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reference Transcript</Label>
                    <div className="mt-2 flex gap-2">
                      <Input
                        className="flex-1"
                        placeholder="What the primary reference audio says..."
                        value={promptText}
                        onChange={(e) => setPromptText(e.target.value)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTranscribe}
                        disabled={transcribing || !refAudioPath}
                      >
                        {transcribing ? <Spinner size={14} /> : <Mic size={14} />}
                        {transcribing ? 'Working...' : 'Transcribe'}
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reference Language</Label>
                    <Select value={promptLang} onValueChange={setPromptLang}>
                      <SelectTrigger className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="zh">Chinese</SelectItem>
                        <SelectItem value="ja">Japanese</SelectItem>
                        <SelectItem value="ko">Korean</SelectItem>
                        <SelectItem value="auto">Auto Detect</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {refAudioUrl && (
                    <div>
                      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Preview</Label>
                      <RefAudioPlayer src={refAudioUrl} />
                    </div>
                  )}
                </div>
              </div>

              {/* Confirm button */}
              <div className="mt-6">
                <Button
                  onClick={() => {
                    if (!refAudioPath) return alert('Select a primary reference audio first');
                    setRefLocked(true);
                  }}
                  disabled={!refAudioPath}
                >
                  <Check size={14} />
                  Confirm Selection
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 03 Text Input */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 text-xs font-semibold">
              3
            </Badge>
            <div>
              <CardTitle>Text to Synthesize</CardTitle>
              <CardDescription>Enter the text you want spoken in the cloned voice</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-[3fr_1fr] gap-6">
            <div>
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Text</Label>
              <Textarea
                className="mt-2 min-h-[140px] leading-relaxed"
                placeholder="Enter the text you want to synthesize..."
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              {text && (
                <p className="mt-1.5 text-right font-mono text-xs text-muted-foreground">
                  {text.length} chars
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Language</Label>
              <Select value={textLang} onValueChange={setTextLang}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="zh">Chinese</SelectItem>
                  <SelectItem value="ja">Japanese</SelectItem>
                  <SelectItem value="ko">Korean</SelectItem>
                  <SelectItem value="auto">Auto Detect</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 04 Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 text-xs font-semibold">
              4
            </Badge>
            <div>
              <CardTitle>Generation Settings</CardTitle>
              <CardDescription>Fine-tune the synthesis parameters</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Collapsible open={showSettings} onOpenChange={setShowSettings}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                <ChevronRight
                  size={14}
                  className={cn("transition-transform", showSettings && "rotate-90")}
                />
                {showSettings ? 'Hide' : 'Show'} parameters
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-x-10">
                {/* Speed */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Speed</Label>
                    <span className="font-mono text-sm font-semibold">{speed.toFixed(1)}x</span>
                  </div>
                  <Slider
                    min={0.5} max={2.0} step={0.1}
                    value={[speed]}
                    onValueChange={([v]) => setSpeed(v)}
                  />
                </div>

                {/* Top K */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Top K</Label>
                    <span className="font-mono text-sm font-semibold">{topK}</span>
                  </div>
                  <Slider
                    min={1} max={50} step={1}
                    value={[topK]}
                    onValueChange={([v]) => setTopK(v)}
                  />
                </div>

                {/* Top P */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Top P</Label>
                    <span className="font-mono text-sm font-semibold">{topP.toFixed(2)}</span>
                  </div>
                  <Slider
                    min={0} max={1} step={0.05}
                    value={[topP]}
                    onValueChange={([v]) => setTopP(v)}
                  />
                </div>

                {/* Temperature */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Temperature</Label>
                    <span className="font-mono text-sm font-semibold">{temperature.toFixed(2)}</span>
                  </div>
                  <Slider
                    min={0} max={1} step={0.05}
                    value={[temperature]}
                    onValueChange={([v]) => setTemperature(v)}
                  />
                </div>

                {/* Repetition Penalty */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Repetition Penalty</Label>
                    <span className="font-mono text-sm font-semibold">{repPenalty.toFixed(2)}</span>
                  </div>
                  <Slider
                    min={1.0} max={2.0} step={0.05}
                    value={[repPenalty]}
                    onValueChange={([v]) => setRepPenalty(v)}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* 05 Generate */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 text-xs font-semibold">
              5
            </Badge>
            <div>
              <CardTitle>Generate</CardTitle>
              <CardDescription>Synthesize speech from your text</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {inference.status !== 'generating' ? (
            <div className={cn("flex items-center gap-4", audioBlob && "mb-6")}>
              <Button
                size="lg"
                onClick={() => { inference.reset(); handleGenerate(); }}
              >
                <Play size={14} />
                Generate Speech
              </Button>

              {inferError && (
                <span className="border-l-2 border-destructive pl-3 text-sm text-destructive">
                  {inferError}
                </span>
              )}
            </div>
          ) : (
            /* Progress UI */
            <div className={cn(audioBlob && "mb-6")}>
              {/* Progress bar */}
              <div className="mb-4 flex items-center gap-4">
                <Progress
                  value={inference.totalChunks > 0 ? (inference.completedChunks / inference.totalChunks) * 100 : 0}
                  className="h-2 flex-1"
                />
                <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                  {inference.completedChunks} / {inference.totalChunks}
                </span>
              </div>

              {/* Current chunk text */}
              {inference.currentChunkText && (
                <div className="mb-4 rounded-md border bg-muted/50 px-4 py-3">
                  <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Synthesizing chunk {inference.completedChunks + 1}
                  </span>
                  <p className="text-sm italic text-muted-foreground">
                    {inference.currentChunkText}
                  </p>
                </div>
              )}

              {/* Cancel button */}
              <Button variant="outline" onClick={handleCancel}>
                <Spinner size={14} />
                Cancel Generation
              </Button>
            </div>
          )}

          <AudioPlayer audioBlob={audioBlob} />
        </CardContent>
      </Card>
    </div>
  );
}
