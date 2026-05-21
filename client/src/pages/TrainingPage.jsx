import React, { useEffect, useRef, useState } from 'react';
import AudioUploader from '../components/AudioUploader.jsx';
import FloatingNotice from '../components/FloatingNotice.jsx';
import { getCurrentTraining, uploadFiles, startTraining, stopTraining } from '../services/api.js';
import { useSSE } from '../hooks/useSSE.js';
import { validateTrainingStart } from '@/lib/trainingValidation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertCircle, AudioLines, ChevronDown, Play, Square, X } from 'lucide-react';
import Spinner from '../components/Spinner.jsx';
import { cn } from '@/lib/utils';

const NOTICE_TIMEOUT_MS = 4200;

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

export default function TrainingPage() {
  const [expName, setExpName] = useState('');
  const [email, setEmail] = useState('');
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
  const [notice, setNotice] = useState(null);

  const { pipelineStatus, error, connect, disconnect, hydrate, reset } = useSSE();
  const restoredSessionRef = useRef(null);
  const noticeTimeoutRef = useRef(null);
  const previousStatusRef = useRef(null);
  const noticesReadyRef = useRef(false);
  const canvasRef = useRef(null);

  const isRunning = pipelineStatus === 'running' || pipelineStatus === 'waiting';
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
            : 'idle';

  function showNotice({ title, message = '', tone = 'success' }) {
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
    const id = Date.now();
    setNotice({ id, title, message, tone });
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice((current) => (current?.id === id ? null : current));
    }, NOTICE_TIMEOUT_MS);
  }

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
        previousStatusRef.current = current.status || 'idle';
      } catch (err) {
        console.error('Failed to restore training state:', err);
      } finally {
        noticesReadyRef.current = true;
        if (previousStatusRef.current === null) {
          previousStatusRef.current = 'idle';
        }
      }
    }

    restoreTrainingState();

    return () => {
      ignore = true;
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, [connect, disconnect, hydrate]);

  useEffect(() => {
    if (!noticesReadyRef.current) return;
    const previousStatus = previousStatusRef.current;
    if (previousStatus === null) {
      previousStatusRef.current = pipelineStatus;
      return;
    }
    if (pipelineStatus !== previousStatus) {
      if (pipelineStatus === 'complete') {
        showNotice({
          title: 'Training complete',
          message: 'Your checkpoints are ready. Open the inference studio to use your new voice.',
          tone: 'success',
        });
      } else if (pipelineStatus === 'error') {
        showNotice({
          title: 'Training needs attention',
          message: error || 'The pipeline stopped before finishing.',
          tone: 'error',
        });
      }
    }
    previousStatusRef.current = pipelineStatus;
  }, [pipelineStatus, error]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let rafId;
    let dots = [];
    const mouse = { x: -999, y: -999 };
    let lastTime = null;

    const REPEL = 90, SPRING = 0.12, DAMP = 0.75;

    function buildGrid() {
      const W = window.innerWidth;
      const H = window.innerHeight;
      canvas.width = W;
      canvas.height = H;
      lastTime = null;

      const spacing = window.devicePixelRatio > 1.5 ? 48 : 32;
      const cols = Math.floor(W / spacing) + 1;
      const rows = Math.floor(H / spacing) + 1;
      const offX = (W - (cols - 1) * spacing) / 2;
      const offY = (H - (rows - 1) * spacing) / 2;

      dots = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const ox = offX + c * spacing;
          const oy = offY + r * spacing;
          dots.push({ ox, oy, x: ox, y: oy, vx: 0, vy: 0 });
        }
      }
    }

    function draw(timestamp) {
      const dt = lastTime === null ? 16.67 : timestamp - lastTime;
      lastTime = timestamp;
      const scale = dt / 16.67;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const d of dots) {
        const dx = d.x - mouse.x;
        const dy = d.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        d.vx += (d.ox - d.x) * SPRING * scale;
        d.vy += (d.oy - d.y) * SPRING * scale;

        if (dist < REPEL && dist > 0) {
          const force = (REPEL - dist) / REPEL * 2.8 * scale;
          d.vx += (dx / dist) * force;
          d.vy += (dy / dist) * force;
        }

        d.vx *= Math.pow(DAMP, scale);
        d.vy *= Math.pow(DAMP, scale);
        d.x += d.vx;
        d.y += d.vy;
      }

      const buckets = new Array(11).fill(null).map(() => []);
      for (const d of dots) {
        const displaced = Math.sqrt((d.x - d.ox) ** 2 + (d.y - d.oy) ** 2);
        const t = Math.min(displaced / 16, 1);
        buckets[Math.round(t * 10)].push(d);
      }
      for (let i = 0; i <= 10; i++) {
        const bucket = buckets[i];
        if (bucket.length === 0) continue;
        const t = i / 10;
        const alpha = 0.35 + t * 0.45;
        const radius = 1.2 + t * 1.4;
        const r = Math.round(148 + t * (99 - 148));
        const g = Math.round(163 + t * (102 - 163));
        const b = Math.round(184 + t * (241 - 184));
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.beginPath();
        for (const d of bucket) {
          ctx.moveTo(d.x + radius, d.y);
          ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      if (mouse.x !== -999) {
        const grd = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 70);
        grd.addColorStop(0, 'rgba(99,102,241,0.10)');
        grd.addColorStop(1, 'rgba(99,102,241,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, 70, 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(draw);
    }

    function onMouseMove(e) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }

    buildGrid();
    rafId = requestAnimationFrame(draw);
    window.addEventListener('mousemove', onMouseMove);
    let resizeTimer;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(buildGrid, 100);
    }
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', onMouseMove);
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  async function handleStart() {
    const validation = validateTrainingStart({
      expName, email, files, batchSize, sovitsEpochs, gptEpochs, sovitsSaveEvery, gptSaveEvery, asrLanguage,
    });
    if (!validation.valid) {
      const message = validation.errors.join(' ');
      setUploadError(message);
      showNotice({ title: 'Check training setup', message, tone: 'error' });
      return;
    }

    setUploadError(null);
    setUploading(true);
    try {
      await uploadFiles(expName, files);
      const res = await startTraining({ expName, email, batchSize, sovitsEpochs, gptEpochs, sovitsSaveEvery, gptSaveEvery, asrLanguage });
      setSessionId(res.data.sessionId);
      restoredSessionRef.current = res.data.sessionId;
      connect(res.data.sessionId, { initialStatus: 'waiting' });
      showNotice({ title: 'Training started', message: "Training has started — we'll email you when it's done.", tone: 'success' });
    } catch (err) {
      setUploadError(err.response?.data?.error || err.message);
      showNotice({ title: 'Training could not start', message: err.response?.data?.error || err.message, tone: 'error' });
    } finally {
      setUploading(false);
    }
  }

  async function handleStop() {
    if (!sessionId) return;
    disconnect();
    reset();
    setSessionId(null);
    restoredSessionRef.current = null;
    showNotice({ title: 'Training stopped', message: 'The current run has been stopped.', tone: 'success' });
    try {
      await stopTraining(sessionId);
    } catch (err) {
      console.error('Failed to stop training:', err);
    }
  }

  function removeFile(index) {
    setFiles(files.filter((_, i) => i !== index));
  }

  return (
    <div className="animate-fade-in flex min-h-0 flex-1 flex-col justify-center py-8">
      <canvas
        ref={canvasRef}
        style={{ position: 'fixed', inset: 0, zIndex: -5, pointerEvents: 'none' }}
        aria-hidden="true"
      />
      <FloatingNotice notice={notice} onClose={() => setNotice(null)} />

      {/* Page title */}
      <div className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight">
          <span className="bg-gradient-to-br from-slate-900 via-slate-800 to-primary/80 bg-clip-text text-transparent">
            Train a voice
          </span>
        </h1>
        <p className="mt-2 text-base text-slate-500">Upload audio clips, name the run, and start.</p>
      </div>

      {/* Two-column form */}
      <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,8fr)_minmax(0,11fr)]">
        {/* Left: fields */}
        <div className="space-y-7">
          <div className="space-y-2">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Experiment Name
            </Label>
            <Input
              className="h-12 rounded-xl border-slate-200 bg-white text-sm shadow-none focus-visible:ring-1"
              placeholder="e.g. voice-run-01"
              value={expName}
              onChange={(e) => setExpName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              disabled={isRunning}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Notify Email
            </Label>
            <Input
              type="email"
              className="h-12 rounded-xl border-slate-200 bg-white text-sm shadow-none focus-visible:ring-1"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isRunning}
            />
          </div>
        </div>

        {/* Right: upload zone */}
        <div className="space-y-2">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Audio Clips
          </Label>
          <AudioUploader files={files} onFilesChange={setFiles} disabled={isRunning} />
        </div>
      </div>

      {/* File list – full width */}
      {files.length > 0 && (
        <div className="mt-8">
          {files.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className="flex items-center gap-4 border-b border-slate-100 py-3 last:border-0"
            >
              <AudioLines size={15} className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{f.name}</span>
              <span className="shrink-0 text-xs text-slate-400">{formatSize(f.size || 0)}</span>
              <button
                type="button"
                className={cn(
                  'shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:text-slate-700',
                  isRunning && 'cursor-not-allowed opacity-40'
                )}
                onClick={() => removeFile(i)}
                disabled={isRunning}
                title="Remove file"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Action bar */}
      <div className="mt-10 flex flex-wrap items-center gap-4">
        {!isRunning ? (
          <Button
            onClick={handleStart}
            disabled={uploading || isRunning}
            className="h-12 rounded-full px-8 text-sm font-semibold shadow-lg shadow-primary/25 [background:linear-gradient(135deg,hsl(224,85%,58%)_0%,hsl(250,80%,62%)_100%)] hover:shadow-primary/35 hover:opacity-95 transition-all"
          >
            {uploading ? (
              <>
                <Spinner size={15} className="text-primary-foreground" />
                Uploading...
              </>
            ) : (
              <>
                <Play size={15} />
                Start training
              </>
            )}
          </Button>
        ) : (
          <Button
            variant="destructive"
            className="h-12 rounded-full px-8 text-sm font-semibold shadow-none"
            onClick={handleStop}
          >
            <Square size={15} />
            Stop training
          </Button>
        )}

        <span className="flex items-center gap-2 text-sm text-slate-500">
          <span className={cn(
            'h-2 w-2 rounded-full',
            pipelineStatus === 'running' ? 'bg-blue-500' :
            pipelineStatus === 'complete' ? 'bg-emerald-500' :
            pipelineStatus === 'error' ? 'bg-red-500' :
            'bg-slate-300'
          )} />
          {files.length > 0 ? `${files.length} clip${files.length !== 1 ? 's' : ''} ready` : 'No clips'} · {statusLabel}
        </span>

        {(error || uploadError) && (
          <span className="flex items-center gap-1.5 text-sm text-red-600">
            <AlertCircle size={14} />
            {error || uploadError}
          </span>
        )}
      </div>

      {/* Additional settings collapsible */}
      <Collapsible open={showSettings} onOpenChange={setShowSettings} className="mt-12">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-slate-700"
          >
            <ChevronDown
              size={15}
              className={cn('transition-transform', showSettings && 'rotate-180')}
            />
            {showSettings ? 'Hide' : 'Show'} additional settings
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-6 grid grid-cols-1 gap-5 rounded-2xl border border-slate-100 bg-slate-50 p-6 md:grid-cols-2 md:gap-x-8">
            {/* Batch Size */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Batch Size</Label>
                <span className="font-mono text-sm font-semibold text-slate-700">{batchSize}</span>
              </div>
              <Slider min={1} max={4} step={1} value={[batchSize]} onValueChange={([v]) => setBatchSize(v)} disabled={isRunning} />
            </div>

            {/* ASR Language */}
            <div className="space-y-3">
              <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">ASR Language</Label>
              <Select value={asrLanguage} onValueChange={setAsrLanguage} disabled={isRunning}>
                <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white shadow-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="zh">Chinese</SelectItem>
                  <SelectItem value="ja">Japanese</SelectItem>
                  <SelectItem value="ko">Korean</SelectItem>
                  <SelectItem value="auto">Auto Detect</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Voice Epochs */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Voice Epochs</Label>
                <span className="font-mono text-sm font-semibold text-slate-700">{sovitsEpochs}</span>
              </div>
              <Slider min={1} max={50} step={1} value={[sovitsEpochs]} onValueChange={([v]) => setSovitsEpochs(v)} disabled={isRunning} />
            </div>

            {/* Language Epochs */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Language Epochs</Label>
                <span className="font-mono text-sm font-semibold text-slate-700">{gptEpochs}</span>
              </div>
              <Slider min={1} max={50} step={1} value={[gptEpochs]} onValueChange={([v]) => setGptEpochs(v)} disabled={isRunning} />
            </div>

            {/* Voice Save Interval */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Voice Save Interval</Label>
                <span className="font-mono text-sm font-semibold text-slate-700">every {sovitsSaveEvery}ep</span>
              </div>
              <Slider min={1} max={10} step={1} value={[sovitsSaveEvery]} onValueChange={([v]) => setSovitsSaveEvery(v)} disabled={isRunning} />
            </div>

            {/* Language Save Interval */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Language Save Interval</Label>
                <span className="font-mono text-sm font-semibold text-slate-700">every {gptSaveEvery}ep</span>
              </div>
              <Slider min={1} max={10} step={1} value={[gptSaveEvery]} onValueChange={([v]) => setGptSaveEvery(v)} disabled={isRunning} />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
