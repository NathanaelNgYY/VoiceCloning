import React, { useEffect, useRef, useState } from 'react';
import AudioUploader from '../components/AudioUploader.jsx';
import ProgressTracker from '../components/ProgressTracker.jsx';
import LogViewer from '../components/LogViewer.jsx';
import { getCurrentTraining, uploadFiles, startTraining, stopTraining } from '../services/api.js';
import { useSSE } from '../hooks/useSSE.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronRight, Play, Square, AlertCircle, Activity, AudioLines } from 'lucide-react';
import Spinner from '../components/Spinner.jsx';
import { cn } from '@/lib/utils';

export default function TrainingPage() {
  const [expName, setExpName] = useState('');
  const [files, setFiles] = useState([]);
  const [batchSize, setBatchSize] = useState(2);
  const [sovitsEpochs, setSovitsEpochs] = useState(20);
  const [gptEpochs, setGptEpochs] = useState(25);
  const [sovitsSaveEvery, setSovitsSaveEvery] = useState(4);
  const [gptSaveEvery, setGptSaveEvery] = useState(5);
  const [asrLanguage, setAsrLanguage] = useState('en');
  const [showSettings, setShowSettings] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [uploadError, setUploadError] = useState(null);

  const { logs, steps, pipelineStatus, error, connect, disconnect, hydrate } = useSSE();
  const restoredSessionRef = useRef(null);

  const isRunning = pipelineStatus === 'running' || pipelineStatus === 'waiting';
  const completedSteps = steps.filter((step) => step.status === 'done').length;
  const statusLabel = pipelineStatus === 'running'
    ? 'Training in progress'
    : pipelineStatus === 'waiting'
      ? 'Waiting for pipeline'
      : pipelineStatus === 'complete'
        ? 'Training complete'
        : pipelineStatus === 'error'
          ? 'Needs attention'
          : pipelineStatus === 'stopped'
            ? 'Stopped'
            : 'Ready to start';

  useEffect(() => {
    let ignore = false;

    async function restoreTrainingState() {
      try {
        const res = await getCurrentTraining();
        const current = res.data;
        if (ignore || !current?.sessionId) return;

        setSessionId(current.sessionId);
        setExpName(current.expName || '');

        if (current.sessionId === restoredSessionRef.current) return;

        const nextState = {
          initialLogs: current.logs || [],
          initialSteps: current.steps || [],
          initialStatus: current.status || 'idle',
          initialError: current.error || null,
        };

        if (current.status === 'running' || current.status === 'waiting') {
          connect(current.sessionId, nextState);
        } else {
          disconnect();
          hydrate(nextState);
        }

        restoredSessionRef.current = current.sessionId;
      } catch (err) {
        console.error('Failed to restore training state:', err);
      }
    }

    restoreTrainingState();

    return () => {
      ignore = true;
    };
  }, [connect, disconnect, hydrate]);

  async function handleStart() {
    if (!expName.trim()) return alert('Enter an experiment name');
    if (files.length === 0) return alert('Upload audio files first');

    setUploadError(null);

    try {
      setUploading(true);
      await uploadFiles(expName, files);
      setUploading(false);

      const res = await startTraining({
        expName,
        batchSize,
        sovitsEpochs,
        gptEpochs,
        sovitsSaveEvery,
        gptSaveEvery,
        asrLanguage,
      });

      setSessionId(res.data.sessionId);
      restoredSessionRef.current = res.data.sessionId;
      connect(res.data.sessionId, { initialStatus: 'waiting' });
    } catch (err) {
      setUploading(false);
      setUploadError(err.response?.data?.error || err.message);
    }
  }

  async function handleStop() {
    if (!sessionId) return;
    try {
      await stopTraining(sessionId);
      disconnect();
      hydrate({
        initialLogs: logs,
        initialSteps: steps,
        initialStatus: 'stopped',
        initialError: 'Training stopped by user',
      });
    } catch (err) {
      console.error('Failed to stop training:', err);
    }
  }

  return (
    <div className="animate-fade-in space-y-8">
      <section className="relative overflow-hidden rounded-[32px] border border-sky-200/50 bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_38%,#0f766e_100%)] px-6 py-7 text-white shadow-[0_32px_90px_-45px_rgba(15,23,42,0.85)] sm:px-8 lg:px-10">
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(125,211,252,0.35),transparent_55%)]" />
        <div className="absolute -left-16 top-8 h-40 w-40 rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="absolute bottom-0 right-8 h-48 w-48 rounded-full bg-emerald-300/15 blur-3xl" />

        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.85fr)] lg:items-end">
          <div>
            <Badge className="border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-white shadow-none">
              Training Pipeline
            </Badge>
            <h2 className="mt-5 max-w-3xl font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Build cleaner voice models with a workflow that stays readable while the pipeline runs.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72 sm:text-base">
              Upload source audio, tune the core training parameters, and follow the full 8-step pipeline without losing context when you come back to the page.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Badge className="border border-white/12 bg-white/10 px-3 py-1.5 text-white shadow-none">
                <Activity size={12} className="mr-1.5" />
                {statusLabel}
              </Badge>
              <Badge className="border border-white/12 bg-white/10 px-3 py-1.5 text-white shadow-none">
                {files.length} uploaded training {files.length === 1 ? 'file' : 'files'}
              </Badge>
              <Badge className="border border-white/12 bg-white/10 px-3 py-1.5 text-white shadow-none">
                {completedSteps} / {steps.length} steps complete
              </Badge>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-[24px] border border-white/12 bg-white/10 p-4 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.85)] backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">Experiment</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight">{expName || 'Untitled project'}</p>
              <p className="mt-2 text-sm leading-6 text-white/72">
                {expName ? 'Your current training run will use this experiment name.' : 'Set an experiment name before starting the pipeline.'}
              </p>
            </div>

            <div className="rounded-[24px] border border-white/12 bg-white/8 p-4 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.85)] backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">Current Focus</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight">{isRunning ? 'Pipeline live' : 'Setup stage'}</p>
              <p className="mt-2 text-sm leading-6 text-white/72">
                {isRunning ? 'Progress and logs will continue restoring if you revisit this page.' : 'Upload audio and configure the run before starting.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 01 Setup */}
      <Card className="overflow-hidden rounded-[28px] border border-sky-100/80 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-sm">
        <CardHeader className="border-b border-slate-100/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.75))]">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 text-sm font-semibold">
              1
            </Badge>
            <div>
              <CardTitle className="font-display text-2xl">Setup</CardTitle>
              <CardDescription>Name your experiment and upload training audio</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-6 rounded-[24px] border border-slate-200 bg-slate-50/80 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
                <AudioLines size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">Project identity</p>
                <p className="text-sm leading-6 text-slate-500">Set the run name and keep your datasets organized.</p>
              </div>
            </div>

            <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Experiment Name
            </Label>
            <Input
              className="h-12 rounded-2xl border-slate-200 bg-white shadow-sm"
              placeholder="e.g. my_voice_model"
              value={expName}
              onChange={(e) => setExpName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              disabled={isRunning}
            />
            {expName && (
              <p className="font-mono text-xs text-muted-foreground">
                Letters, numbers, hyphens, underscores only
              </p>
            )}
          </div>

            <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Quick Summary</p>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="grid grid-cols-[auto,minmax(0,1fr)] gap-3">
                  <span>Dataset</span>
                  <span className="min-w-0 text-right font-semibold text-slate-800">{files.length} file{files.length === 1 ? '' : 's'}</span>
                </div>
                <div className="grid grid-cols-[auto,minmax(0,1fr)] gap-3">
                  <span>Pipeline</span>
                  <span className="min-w-0 text-right font-semibold text-slate-800">{statusLabel}</span>
                </div>
                <div className="grid grid-cols-[auto,minmax(0,1fr)] gap-3">
                  <span>Next step</span>
                  <span className="min-w-0 text-right font-semibold text-slate-800">{isRunning ? 'Monitor progress' : 'Upload audio'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-[24px] border border-slate-200 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(240,249,255,0.74))] p-5">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Training Audio
            </Label>
            <AudioUploader files={files} onFilesChange={setFiles} disabled={isRunning} />
          </div>

          {uploadError && (
            <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive lg:col-span-2">
              <AlertCircle size={16} />
              {uploadError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 02 Configuration */}
      <Card className="overflow-hidden rounded-[28px] border border-sky-100/80 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-sm">
        <CardHeader className="border-b border-slate-100/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.75))]">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 text-sm font-semibold">
              2
            </Badge>
            <div>
              <CardTitle className="font-display text-2xl">Configuration</CardTitle>
              <CardDescription>Training parameters and settings</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <Collapsible open={showSettings} onOpenChange={setShowSettings}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 rounded-2xl border-slate-200 text-muted-foreground">
                <ChevronRight
                  size={14}
                  className={cn("transition-transform", showSettings && "rotate-90")}
                />
                {showSettings ? 'Hide' : 'Show'} advanced settings
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-x-10">
                {/* Batch Size */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Batch Size</Label>
                    <span className="font-mono text-sm font-semibold">{batchSize}</span>
                  </div>
                  <Slider
                    min={1} max={4} step={1}
                    value={[batchSize]}
                    onValueChange={([v]) => setBatchSize(v)}
                    disabled={isRunning}
                  />
                </div>

                {/* ASR Language */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">ASR Language</Label>
                  <Select value={asrLanguage} onValueChange={setAsrLanguage} disabled={isRunning}>
                    <SelectTrigger className="rounded-2xl border-slate-200 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="zh">Chinese</SelectItem>
                      <SelectItem value="ja">Japanese</SelectItem>
                      <SelectItem value="ko">Korean</SelectItem>
                      <SelectItem value="auto">Auto Detect</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* SoVITS Epochs */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">SoVITS Epochs</Label>
                    <span className="font-mono text-sm font-semibold">{sovitsEpochs}</span>
                  </div>
                  <Slider
                    min={1} max={50} step={1}
                    value={[sovitsEpochs]}
                    onValueChange={([v]) => setSovitsEpochs(v)}
                    disabled={isRunning}
                  />
                </div>

                {/* GPT Epochs */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">GPT Epochs</Label>
                    <span className="font-mono text-sm font-semibold">{gptEpochs}</span>
                  </div>
                  <Slider
                    min={1} max={50} step={1}
                    value={[gptEpochs]}
                    onValueChange={([v]) => setGptEpochs(v)}
                    disabled={isRunning}
                  />
                </div>

                {/* SoVITS Save Interval */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">SoVITS Save Interval</Label>
                    <span className="font-mono text-sm font-semibold">every {sovitsSaveEvery}ep</span>
                  </div>
                  <Slider
                    min={1} max={10} step={1}
                    value={[sovitsSaveEvery]}
                    onValueChange={([v]) => setSovitsSaveEvery(v)}
                    disabled={isRunning}
                  />
                </div>

                {/* GPT Save Interval */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">GPT Save Interval</Label>
                    <span className="font-mono text-sm font-semibold">every {gptSaveEvery}ep</span>
                  </div>
                  <Slider
                    min={1} max={10} step={1}
                    value={[gptSaveEvery]}
                    onValueChange={([v]) => setGptSaveEvery(v)}
                    disabled={isRunning}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* 03 Pipeline */}
      <Card className="overflow-hidden rounded-[28px] border border-sky-100/80 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-sm">
        <CardHeader className="border-b border-slate-100/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.75))]">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 text-sm font-semibold">
              3
            </Badge>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <CardTitle className="font-display text-2xl">Pipeline</CardTitle>
                {pipelineStatus === 'running' && (
                  <Badge className="animate-pulse-dot">Running</Badge>
                )}
                {pipelineStatus === 'complete' && (
                  <Badge variant="success">Complete</Badge>
                )}
                {pipelineStatus === 'error' && (
                  <Badge variant="destructive">Error</Badge>
                )}
              </div>
              <CardDescription>8-step training pipeline progress</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Progress</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-800">{completedSteps}/{steps.length}</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">Pipeline steps completed so far.</p>
            </div>
            <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Batch</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-800">{batchSize}</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">Current batch size for this run.</p>
            </div>
            <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Language</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-800">{asrLanguage.toUpperCase()}</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">ASR language used during preprocessing.</p>
            </div>
          </div>

          <ProgressTracker steps={steps} />

          <div className="flex items-center gap-4">
            {!isRunning ? (
              <Button
                onClick={handleStart}
                disabled={uploading || isRunning}
                size="lg"
                className="rounded-2xl shadow-[0_20px_50px_-28px_rgba(14,165,233,0.75)]"
              >
                {uploading ? (
                  <>
                    <Spinner size={14} className="text-primary-foreground" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    Start Training
                  </>
                )}
              </Button>
            ) : (
              <Button variant="destructive" size="lg" className="rounded-2xl" onClick={handleStop}>
                <Square size={14} />
                Stop Training
              </Button>
            )}

            {error && (
              <span className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                {error}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 04 Logs */}
      <Card className="overflow-hidden rounded-[28px] border border-sky-100/80 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-sm">
        <CardHeader className="border-b border-slate-100/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.75))]">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 text-sm font-semibold">
              4
            </Badge>
            <div>
              <CardTitle className="font-display text-2xl">Logs</CardTitle>
              <CardDescription>Real-time training output</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <LogViewer logs={logs} />
        </CardContent>
      </Card>
    </div>
  );
}
