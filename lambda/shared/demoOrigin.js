// Detect whether an incoming Lambda request came from the demo CloudFront distribution
// and, if so, produce the header that tells the gpu-inference-worker to give it GPU
// priority (preempt any in-flight Live Full generation).
//
// The demo host is configured PER-DEPLOYMENT via the DEMO_CLOUDFRONT_HOST env var, so
// the same shared lambda code works for every frontend — each deployment sets it to its
// own demo distribution domain (e.g. dxxxx.cloudfront.net). Unset => nothing is ever
// treated as demo (fail-safe: normal traffic is never preempted).
export function isDemoEvent(event, { demoHost = process.env.DEMO_CLOUDFRONT_HOST || '' } = {}) {
  const host = String(demoHost).trim().toLowerCase();
  if (!host) return false;
  const headers = event?.headers || {};
  const viewer = String(
    headers.host
    || headers['x-forwarded-host']
    || headers.origin
    || headers.referer
    || '',
  ).toLowerCase();
  return viewer.includes(host);
}

// Header bag to spread into an inferencePost/inferencePostBinary call. Empty for
// non-demo requests, so those calls are byte-for-byte unchanged.
export function demoHeaders(event, opts = {}) {
  return isDemoEvent(event, opts) ? { 'X-Demo-Request': 'true' } : {};
}
