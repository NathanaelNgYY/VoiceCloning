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
import { ChevronRight, Play, Square, AlertCircle } from 'lucide-react';
import Spinner from '../components/Spinner.jsx';
import { cn } from '@/lib/utils';

export default function TrainingPage() {
  const [expName, setExpName] = useState('');
  const [files, setFiles] = useState([]);
  const [batchSize, setBatchSize] = useState(2);
  const [sovitsEpochs, setSovitsEpochs] = useState(8);
  const [gptEpochs, setGptEpochs] = useState(15);
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

      {/* 01 Setup */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 text-xs font-semibold">
              1
            </Badge>
            <div>
              <CardTitle>Setup</CardTitle>
              <CardDescription>Name your experiment and upload training audio</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Experiment Name
            </Label>
            <Input
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

          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Training Audio
            </Label>
            <AudioUploader files={files} onFilesChange={setFiles} disabled={isRunning} />
          </div>

          {uploadError && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <AlertCircle size={16} />
              {uploadError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 02 Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 text-xs font-semibold">
              2
            </Badge>
            <div>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>Training parameters and settings</CardDescription>
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
                {showSettings ? 'Hide' : 'Show'} advanced settings
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-x-10">
                {/* Batch Size */}
                <div className="space-y-3">
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
                <div className="space-y-3">
                  <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">ASR Language</Label>
                  <Select value={asrLanguage} onValueChange={setAsrLanguage} disabled={isRunning}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                <div className="space-y-3">
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
                <div className="space-y-3">
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
                <div className="space-y-3">
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
                <div className="space-y-3">
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
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 text-xs font-semibold">
              3
            </Badge>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <CardTitle>Pipeline</CardTitle>
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
        <CardContent className="space-y-6">
          <ProgressTracker steps={steps} />

          <div className="flex items-center gap-4">
            {!isRunning ? (
              <Button
                onClick={handleStart}
                disabled={uploading || isRunning}
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
              <Button variant="destructive" onClick={handleStop}>
                <Square size={14} />
                Stop Training
              </Button>
            )}

            {error && (
              <span className="border-l-2 border-destructive pl-3 text-sm text-destructive">
                {error}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 04 Logs */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 text-xs font-semibold">
              4
            </Badge>
            <div>
              <CardTitle>Logs</CardTitle>
              <CardDescription>Real-time training output</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <LogViewer logs={logs} />
        </CardContent>
      </Card>
    </div>
  );
}
