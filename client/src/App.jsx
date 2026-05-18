import React, { useEffect, useState } from 'react';
import { Navigate, Routes, Route, NavLink } from 'react-router-dom';
import { Power } from 'lucide-react';

function AnimatedBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {/* Blue orb — top-left */}
      <div className="absolute -left-40 -top-40 h-[560px] w-[560px] animate-orb-float-1 rounded-full bg-blue-400/30 blur-[110px]" />
      {/* Violet orb — top-right */}
      <div className="absolute -right-32 -top-24 h-[460px] w-[460px] animate-orb-float-2 rounded-full bg-violet-400/25 blur-[110px]" />
      {/* Cyan orb — bottom-centre */}
      <div className="absolute -bottom-32 left-1/2 h-[420px] w-[420px] -translate-x-1/2 animate-orb-float-3 rounded-full bg-sky-300/20 blur-[100px]" />
    </div>
  );
}
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { APP_MODE_CONFIG } from '@/lib/appMode';
import { getInstanceStatus, startInstance } from './services/api.js';
import TrainingPage from './pages/TrainingPage.jsx';
import LivePage from './pages/LivePage.jsx';
import TtsTestPage from './pages/TtsTestPage.jsx';

function GpuInstanceControl() {
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(true);
  const [starting, setStarting] = useState(false);

  async function refreshStatus() {
    setChecking(true);
    try {
      const res = await getInstanceStatus();
      setStatus(res.data);
    } catch (err) {
      setStatus({
        configured: true,
        state: 'unavailable',
        workerReady: false,
        startable: false,
        message: err.response?.data?.error || err.message || 'Could not check GPU instance status.',
      });
    } finally {
      setChecking(false);
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

  if (checking && !status) {
    return (
      <button
        type="button"
        disabled
        title="Checking the GPU instance status."
        className="inline-flex h-8 cursor-wait items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-400"
      >
        <Power size={12} />
        Checking GPU
      </button>
    );
  }

  if (!status?.configured) {
    return (
      <button
        type="button"
        disabled
        title={status?.message || 'GPU instance control is not configured yet.'}
        className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-400"
      >
        <Power size={12} />
        GPU not configured
      </button>
    );
  }

  const isReady = status.workerReady;
  const canStart = status.startable && !starting;
  const label = isReady
    ? 'GPU ready'
    : status.state === 'stopped'
      ? 'Start GPU'
      : starting || status.state === 'pending'
        ? 'Starting GPU'
        : status.state === 'running'
          ? 'GPU warming up'
        : `GPU ${status.state || 'unknown'}`;
  const title = status.message
    || (status.state === 'running' && !status.workerReady
      ? 'The EC2 instance is running, but the GPU worker is still warming up.'
      : label);

  return (
    <button
      type="button"
      onClick={handleStart}
      disabled={!canStart}
      title={title}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
        isReady
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : canStart
            ? 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            : 'cursor-not-allowed border-slate-200 bg-white text-slate-400'
      )}
    >
      <span className={cn(
        'h-2 w-2 rounded-full',
        isReady ? 'bg-emerald-500' : canStart ? 'bg-slate-300' : 'bg-slate-200'
      )} />
      {label}
    </button>
  );
}

export default function App() {
  const appConfig = APP_MODE_CONFIG;

  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col">
        <AnimatedBackground />
        {/* Minimal header */}
        <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-8">
            <nav className="flex items-center gap-1">
              {appConfig.navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
                      isActive
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <NavLink
                to="/tts-test"
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
                    isActive
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                  )
                }
              >
                TTS Test
              </NavLink>
            </nav>
            <GpuInstanceControl />
          </div>
          {/* thin gradient accent line */}
          <div className="h-px bg-gradient-to-r from-primary/30 via-violet-400/20 to-transparent" />
        </header>

        {/* Main content */}
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-8 py-8">
          <Routes>
            <Route
              path="/"
              element={
                appConfig.showTraining
                  ? <TrainingPage />
                  : appConfig.showLiveFast
                    ? <LivePage replyMode="phrases" />
                    : <Navigate to={appConfig.defaultPath} replace />
              }
            />
            <Route
              path="/live-fast"
              element={
                appConfig.showLiveFast
                  ? <LivePage replyMode="phrases" />
                  : <Navigate to={appConfig.defaultPath} replace />
              }
            />
            <Route path="/tts-test" element={<TtsTestPage />} />
            <Route path="/inference" element={<Navigate to={appConfig.defaultPath} replace />} />
            <Route path="/live" element={<Navigate to={appConfig.defaultPath} replace />} />
            <Route path="*" element={<Navigate to={appConfig.defaultPath} replace />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="mx-auto w-full max-w-6xl border-t border-slate-100 px-8">
          <div className="flex items-center justify-between py-5">
            <span className="text-xs text-slate-400">Voice Cloning Studio</span>
            <span className="text-xs text-slate-400">Built with GPT-SoVITS</span>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
