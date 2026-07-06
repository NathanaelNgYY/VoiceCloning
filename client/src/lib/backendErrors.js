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
