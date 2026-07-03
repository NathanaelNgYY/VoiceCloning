// ── Demo preemption helper (opt-in; NOT wired into any route by default) ──
//
// Purpose: let requests coming ONLY from the demo CloudFront (the chatbot-live-full
// demo distribution) jump the queue — instead of being rejected with 409 when another
// generation is running, they cancel the in-flight generation and take over. Normal
// (non-demo) traffic keeps the existing 409 "one generation at a time" behavior.
//
// A request counts as "demo" via EITHER of:
//   1. An explicit  X-Demo-Request: true  header. This is the reliable path in this
//      architecture: the browser calls CloudFront -> Lambda -> worker, so the worker
//      never sees the browser's CloudFront origin (the Lambda makes a fresh fetch). The
//      Lambda must therefore detect the demo distribution and stamp this header on the
//      inference call. See LAMBDA WIRING below.
//   2. A request Origin/Referer/Host matching DEMO_ORIGIN_HOSTS. This only fires if the
//      browser talks to the worker DIRECTLY (no Lambda hop). Kept as a fallback / for
//      any direct-call path; harmless when it never matches.
//
// This module is intentionally standalone so it can be reviewed and wired in
// separately. Nothing here runs until a route calls it. See "WIRING" at the bottom.

import { inferenceState } from './inferenceState.js';
import { cancelSession } from './longTextInference.js';

// Hosts that identify the demo CloudFront. Set DEMO_ORIGIN_HOSTS in the worker .env to
// the demo distribution domain(s), comma-separated, e.g.:
//   DEMO_ORIGIN_HOSTS=dxxxxx.cloudfront.net,demo.yourdomain.com
// Matching is done against Origin / Referer / X-Forwarded-Host so it works whether the
// request arrives directly or proxied.
const DEMO_ORIGIN_HOSTS = String(process.env.DEMO_ORIGIN_HOSTS || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function hostOf(value) {
  if (!value) return '';
  try {
    // Accept a bare host or a full URL.
    return new URL(/^https?:\/\//iu.test(value) ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
}

// True when the request is a demo request: an explicit X-Demo-Request header (the
// reliable Lambda-stamped path), OR an origin matching DEMO_ORIGIN_HOSTS (direct-call
// fallback). Fail-safe: with no header and no configured hosts, nothing is ever demo,
// so this can never accidentally preempt real traffic.
export function isDemoRequest(req, { demoHosts = DEMO_ORIGIN_HOSTS } = {}) {
  if (!req) return false;
  const headers = req.headers || {};
  if (/^(1|true|yes|on)$/iu.test(String(headers['x-demo-request'] || '').trim())) {
    return true;
  }
  if (!demoHosts.length) return false;
  const candidates = [
    headers.origin,
    headers.referer,
    headers['x-forwarded-host'],
    headers.host,
  ].map(hostOf).filter(Boolean);
  return candidates.some((host) => demoHosts.includes(host));
}

// Cancel whatever generation is currently running so a demo request can take over.
// Safe to call even when nothing is running (no-op). Returns what it did so the caller
// can log it.
export function preemptActiveGeneration() {
  const state = inferenceState.getState();
  const active = ['waiting', 'generating'].includes(state.status);
  let cancelledSessionId = null;
  if (active) {
    cancelledSessionId = state.sessionId || null;
    if (cancelledSessionId) cancelSession(cancelledSessionId);
    // Drive state terminal even if the session already ended, so the next
    // resetForNewSession starts from a clean slate.
    inferenceState.setError('Preempted by demo request', 'cancelled');
  }
  return { preempted: active, cancelledSessionId };
}

// ── WIRING (for your teammate) ───────────────────────────────────────────────
// In routes/inference.js, inside POST '/inference/generate' (and/or '/inference'),
// replace the hard 409 guard with a demo-aware version:
//
//   import { isDemoRequest, preemptActiveGeneration } from '../services/demoPreempt.js';
//
//   const busy = ['waiting', 'generating'].includes(inferenceState.getState().status);
//   if (busy) {
//     if (isDemoRequest(req)) {
//       preemptActiveGeneration();          // demo jumps the queue
//     } else {
//       return res.status(409).json({ error: 'Another generation is already running on this instance' });
//     }
//   }
//
// Non-demo traffic is unaffected; only requests marked demo (below) preempt.
//
// ── LAMBDA WIRING (required — the worker sits behind the Lambda) ──────────────
// Because browser -> CloudFront -> Lambda -> worker, the worker cannot see the demo
// CloudFront origin. The Lambda must detect the demo distribution and forward the
// X-Demo-Request header on its inference call. Two small edits in the lambda:
//
// 1. lambda/shared/gpuWorker.js — let inferencePost forward extra headers:
//      export async function inferencePost(routePath, body = {}, extraHeaders = {}) {
//        const response = await fetch(`${inferenceBaseUrl()}${routePath}`, {
//          method: 'POST',
//          headers: { 'Content-Type': 'application/json', ...extraHeaders },
//          body: JSON.stringify(body),
//        });
//        ...
//
// 2. In the inference handler, detect the demo CloudFront from the incoming event
//    (its viewer host is d2o0cbe2zunqkr.cloudfront.net) and pass the header:
//      const isDemo = (event.headers?.host || event.headers?.['x-forwarded-host'] || '')
//        .toLowerCase().includes('d2o0cbe2zunqkr.cloudfront.net');
//      await inferencePost('/inference/generate', body, isDemo ? { 'X-Demo-Request': 'true' } : {});
