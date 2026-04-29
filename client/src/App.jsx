import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { Activity, Power } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getInstanceStatus, startInstance } from './services/api.js';
import TrainingPage from './pages/TrainingPage.jsx';
import InferencePage from './pages/InferencePage.jsx';
import LivePage from './pages/LivePage.jsx';

function GpuInstanceControl() {
  const [status, setStatus] = useState(null);
  const [starting, setStarting] = useState(false);

  async function refreshStatus() {
    try {
      const res = await getInstanceStatus();
      setStatus(res.data);
    } catch {
      setStatus(null);
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    if (!status?.configured) return undefined;
    if (status.workerReady) return undefined;

    const id = window.setInterval(refreshStatus, 8000);
    return () => window.clearInterval(id);
  }, [status?.configured, status?.workerReady, status?.state]);

  useEffect(() => {
    if (status?.workerReady) {
      window.dispatchEvent(new Event('voice-cloning-gpu-ready'));
    }
  }, [status?.workerReady]);

  async function handleStart() {
    setStarting(true);
    try {
      const res = await startInstance();
      setStatus(res.data);
      window.setTimeout(refreshStatus, 5000);
    } catch (err) {
      setStatus((current) => ({
        ...(current || {}),
        configured: true,
        state: current?.state || 'unknown',
        workerReady: false,
        startable: false,
        message: err.response?.data?.error || err.message || 'Could not start GPU instance.',
      }));
    } finally {
      setStarting(false);
    }
  }

  if (!status?.configured) return null;

  const isReady = status.workerReady;
  const canStart = status.startable && !starting;
  const label = isReady
    ? 'GPU ready'
    : status.state === 'stopped'
      ? 'Start GPU'
      : starting || status.state === 'pending'
        ? 'Starting GPU'
        : `GPU ${status.state || 'unknown'}`;

  return (
    <button
      type="button"
      onClick={handleStart}
      disabled={!canStart}
      title={status.message || label}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-2xl border px-3 text-xs font-semibold transition-colors',
        isReady
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : canStart
            ? 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100'
            : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-500'
      )}
    >
      <Power size={14} />
      {label}
    </button>
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col bg-background">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b border-white/60 bg-white/75 backdrop-blur-xl">
          <div className="mx-auto max-w-6xl px-6">
            {/* Title row */}
            <div className="flex items-center justify-between pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-primary shadow-[0_18px_35px_-24px_rgba(14,165,233,0.85)]">
                  <Activity className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-foreground">
                    Voice Cloning Studio
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    GPT-SoVITS Training & Inference
                  </p>
                </div>
              </div>
              <GpuInstanceControl />
            </div>

            {/* Navigation */}
            <nav className="mt-4 flex items-center gap-7 border-b border-slate-200/80">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  cn(
                    "group relative inline-flex h-11 items-center text-sm font-medium transition-colors",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span>Training</span>
                    <span
                      className={cn(
                        "absolute inset-x-0 bottom-0 h-0.5 rounded-full transition-colors",
                        isActive ? "bg-primary" : "bg-transparent group-hover:bg-slate-200"
                      )}
                    />
                  </>
                )}
              </NavLink>
              <NavLink
                to="/inference"
                className={({ isActive }) =>
                  cn(
                    "group relative inline-flex h-11 items-center text-sm font-medium transition-colors",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span>Inference</span>
                    <span
                      className={cn(
                        "absolute inset-x-0 bottom-0 h-0.5 rounded-full transition-colors",
                        isActive ? "bg-primary" : "bg-transparent group-hover:bg-slate-200"
                      )}
                    />
                  </>
                )}
              </NavLink>
              <NavLink
                to="/live"
                className={({ isActive }) =>
                  cn(
                    "group relative inline-flex h-11 items-center text-sm font-medium transition-colors",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span>Live Full</span>
                    <span
                      className={cn(
                        "absolute inset-x-0 bottom-0 h-0.5 rounded-full transition-colors",
                        isActive ? "bg-primary" : "bg-transparent group-hover:bg-slate-200"
                      )}
                    />
                  </>
                )}
              </NavLink>
              <NavLink
                to="/live-fast"
                className={({ isActive }) =>
                  cn(
                    "group relative inline-flex h-11 items-center text-sm font-medium transition-colors",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span>Live Fast</span>
                    <span
                      className={cn(
                        "absolute inset-x-0 bottom-0 h-0.5 rounded-full transition-colors",
                        isActive ? "bg-primary" : "bg-transparent group-hover:bg-slate-200"
                      )}
                    />
                  </>
                )}
              </NavLink>
            </nav>
          </div>
        </header>

        {/* Main content */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
          <Routes>
            <Route path="/" element={<TrainingPage />} />
            <Route path="/inference" element={<InferencePage />} />
            <Route path="/live" element={<LivePage replyMode="full" />} />
            <Route path="/live-fast" element={<LivePage replyMode="phrases" />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="mx-auto w-full max-w-6xl px-6">
          <Separator />
          <div className="flex items-center justify-between py-5">
            <span className="text-xs text-muted-foreground">
              Voice Cloning Studio
            </span>
            <span className="text-xs text-muted-foreground">
              Built with GPT-SoVITS
            </span>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
