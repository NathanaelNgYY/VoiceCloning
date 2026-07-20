import React, { useEffect, useState } from 'react';
import { Navigate, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { Loader2, Power } from 'lucide-react';

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
import { GpuStatusProvider, useGpuStatus } from '@/lib/gpuStatus.jsx';

// Live-fast (doovx…) and the Dean demo have no training UI — those are the builds
// that should auto-start the GPU and show the "starting" overlay on entry.
const GPU_AUTO_START = !APP_MODE_CONFIG.showTraining;
import TrainingPage from './pages/TrainingPage.jsx';
import LivePage from './pages/LivePage.jsx';
import GiChatPage from './pages/GiChatPage.jsx';

function LiveFastEntry() {
  const location = useLocation();
  const tab = new URLSearchParams(location.search).get('tab');
  return <LivePage replyMode="phrases" mode={tab === 'text-to-speech' ? 'tts' : 'chat'} />;
}

function GpuInstanceControl() {
  const { status, checking, starting, start: handleStart } = useGpuStatus();

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

function GpuStartingOverlay() {
  const { status, checking, starting, workerReady, start } = useGpuStatus();

  // Only block the page for the auto-start builds, and only until the worker is
  // actually ready. Local dev (no instance configured) is never blocked.
  const configured = status?.configured;
  if (workerReady) return null;
  if (!checking && !configured) return null;

  const state = status?.state;
  const unavailable = state === 'unavailable' || state === 'unknown';
  const stopping = state === 'stopping' || state === 'shutting-down';
  const heading = unavailable
    ? 'Waiting for the GPU'
    : stopping
      ? 'Stopping the GPU'
      : state === 'running'
        ? 'Warming up the GPU'
        : 'Starting the GPU';
  const detail = unavailable
    ? (status?.message || 'Trying to reach the GPU instance…')
    : stopping
      ? 'The shared GPU is shutting down after being idle. It will restart automatically — hang tight.'
      : state === 'running'
        ? 'The instance is up — loading the voice engine. This takes a few seconds.'
        : starting || state === 'pending'
          ? 'Powering on the shared GPU instance. This can take up to a minute on a cold start.'
          : 'Getting the GPU ready…';

  // Don't offer a manual retry while it's mid-stop (it isn't startable until fully
  // stopped, and auto-start will pick it up then).
  const canManualStart = status?.startable && !starting && !stopping;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/70 px-6 backdrop-blur-md">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/95 p-8 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          {unavailable
            ? <Power size={26} className="text-primary" />
            : <Loader2 size={26} className="animate-spin text-primary" />}
        </div>
        <h1 className="text-lg font-semibold text-slate-900">{heading}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{detail}</p>
        {unavailable && canManualStart && (
          <button
            type="button"
            onClick={start}
            className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-4 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
          >
            <Power size={14} />
            Retry starting GPU
          </button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <GpuStatusProvider autoStart={GPU_AUTO_START}>
      <AppShell />
    </GpuStatusProvider>
  );
}

function AppShell() {
  const appConfig = APP_MODE_CONFIG;

  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col">
        <AnimatedBackground />
        {GPU_AUTO_START && <GpuStartingOverlay />}
        {/* Minimal header */}
        {!appConfig.showGiChat && (
        <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-8">
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
            </nav>
            <GpuInstanceControl />
          </div>
          {/* thin gradient accent line */}
          <div className="h-px bg-gradient-to-r from-primary/30 via-violet-400/20 to-transparent" />
        </header>
        )}

        {/* Main content */}
        <main className={cn(
          'flex w-full flex-1 flex-col',
          appConfig.showGiChat ? 'min-h-0' : 'mx-auto max-w-6xl px-4 py-4 sm:px-8 sm:py-8'
        )}>
          <Routes>
            <Route
              path="/"
              element={
                appConfig.showGiChat
                  ? <GiChatPage />
                  : appConfig.showTraining
                    ? <TrainingPage />
                    : appConfig.showLiveFast
                      ? <LiveFastEntry />
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
            <Route
              path="/text-to-speech"
              element={
                appConfig.showTextToSpeech
                  ? <LivePage replyMode="phrases" mode="tts" />
                  : <Navigate to={appConfig.defaultPath} replace />
              }
            />
            <Route path="/inference" element={<Navigate to={appConfig.defaultPath} replace />} />
            <Route path="/live" element={<Navigate to={appConfig.defaultPath} replace />} />
            <Route path="*" element={<Navigate to={appConfig.defaultPath} replace />} />
          </Routes>
        </main>

        {/* Footer */}
        {!appConfig.showGiChat && (
        <footer className="mx-auto w-full max-w-6xl border-t border-slate-100 px-4 sm:px-8">
          <div className="flex items-center py-5">
            <span className="text-xs text-slate-400">Voice Cloning Studio</span>
          </div>
        </footer>
        )}
      </div>
    </TooltipProvider>
  );
}
