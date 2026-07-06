import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getInstanceStatus, startInstance } from '../services/api.js';

const GpuStatusContext = createContext(null);

// Single source of truth for the shared GPU instance lifecycle. Both the header
// button and the full-screen "starting" overlay read from here, and pages gate
// their backend calls on `workerReady` so we never fire model/status requests at
// a cold GPU (which is what surfaced the raw 503 / 404 error banners).
export function GpuStatusProvider({ children, autoStart = false }) {
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(true);
  const [starting, setStarting] = useState(false);
  const autoStartedRef = useRef(false);
  const prevWorkerReadyRef = useRef(false);

  const refreshStatus = useCallback(async () => {
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
  }, []);

  const start = useCallback(async () => {
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
  }, [refreshStatus]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Poll until the worker is ready; once ready we stop hammering the endpoint.
  useEffect(() => {
    if (!status?.configured) return undefined;
    if (status.workerReady) return undefined;
    const id = window.setInterval(refreshStatus, 8000);
    return () => window.clearInterval(id);
  }, [status?.configured, status?.workerReady, status?.state, refreshStatus]);

  // Auto-start the GPU the first time we see it stopped (live-fast / demo only).
  useEffect(() => {
    if (!autoStart) return;
    if (autoStartedRef.current) return;
    if (!status?.configured) return;
    if (status.workerReady || starting) return;
    if (status.startable && status.state === 'stopped') {
      autoStartedRef.current = true;
      start();
    }
  }, [autoStart, status?.configured, status?.workerReady, status?.startable, status?.state, starting, start]);

  // Notify pages the moment the worker flips ready so they can (re)load models.
  useEffect(() => {
    const ready = Boolean(status?.workerReady);
    if (ready && !prevWorkerReadyRef.current) {
      window.dispatchEvent(new Event('voice-cloning-gpu-ready'));
    }
    prevWorkerReadyRef.current = ready;
  }, [status?.workerReady]);

  const value = {
    status,
    checking,
    starting,
    workerReady: Boolean(status?.workerReady),
    configured: Boolean(status?.configured),
    refreshStatus,
    start,
  };

  return <GpuStatusContext.Provider value={value}>{children}</GpuStatusContext.Provider>;
}

export function useGpuStatus() {
  return useContext(GpuStatusContext) || {
    status: null,
    checking: false,
    starting: false,
    workerReady: false,
    configured: false,
    refreshStatus: () => {},
    start: () => {},
  };
}
