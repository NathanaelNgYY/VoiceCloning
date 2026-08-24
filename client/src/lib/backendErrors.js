// Transient errors we see while the shared GPU is waking up or a model is mid-load:
// CloudFront/nginx 5xx pages, 404s from an endpoint that isn't warmed yet, and
// plain network drops. These should be retried and never surfaced as a raw banner
// (that's how the "<html>...503 Service Temporarily Unavailable" text leaked onto
// the page).
const TRANSIENT_STATUSES = new Set([404, 425, 429, 500, 502, 503, 504]);

export function isTransientBackendError(err) {
  const status = err?.response?.status;
  if (status == null) return true; // no response == network/timeout, treat as transient
  return TRANSIENT_STATUSES.has(status);
}

// Synthesis failures worth another attempt: the GPU busy/conflict responses the
// live path has always retried, plus anything services/api.js already recognised
// as GPU-offline (a booting instance, a voice model mid-load, a synthesis-queue
// timeout). Classification is by `code`/`status`, never by message text — api.js
// replaces a 5xx body with GPU_OFFLINE_MESSAGE, which is how a text-matching
// predicate silently stopped retrying the exact case it was written for.
const RETRYABLE_SYNTHESIS_STATUSES = new Set([409, 425, 429, 502, 503, 504]);

export function isRetryableSynthesisError(err) {
  if (err?.code === 'MODEL_CAPACITY_STARTING' || err?.code === 'MODEL_CAPACITY_LIMIT') return false;
  if (err?.code === 'GPU_OFFLINE') return true;
  const status = Number(err?.status ?? err?.response?.status);
  if (RETRYABLE_SYNTHESIS_STATUSES.has(status)) return true;
  return /already|busy|conflict|409|503/i.test(err?.message || '');
}

// A warming GPU needs seconds, not milliseconds: the Lambda has already spent its
// own capacity-retry budget upstream before this error reached us, so back off
// harder than for a plain "GPU is busy with another clip" conflict.
export function synthesisRetryDelayMs(err, attempt) {
  const base = err?.code === 'GPU_OFFLINE' ? 2000 : 650;
  return base * (attempt + 1);
}

// Strip any HTML (CloudFront/nginx error pages) and collapse whitespace. If what's
// left looks like a bare gateway error ("503 Service Temporarily Unavailable",
// "Request failed with status code 404", etc.) we return '' so the caller can show
// its own friendly "warming up" state instead.
export function sanitizeBackendError(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const stripped = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (/service temporarily unavailable/i.test(stripped)) return '';
  if (/\b(404|502|503|504)\b/.test(stripped) && /(status code|unavailable|gateway|not found|error)/i.test(stripped)) {
    return '';
  }
  return stripped;
}
