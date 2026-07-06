// Detect whether an incoming Lambda request came from the demo CloudFront distribution
// and, if so, produce the header that tells the gpu-inference-worker to give it GPU
// priority (preempt any in-flight Live Full generation).
//
// One shared backend (lambda + GPU) serves multiple CloudFront frontends, so the ONLY
// reliable way to tell the demo distribution apart is a signal the distribution itself
// injects. Detection, in priority order:
//   1. An incoming `X-Demo-Request: true` header. Configure the DEMO CloudFront
//      distribution to add this as a CUSTOM ORIGIN HEADER — CloudFront attaches it to
//      every origin request, so the lambda sees it reliably regardless of Host rewriting.
//      This is the recommended, deployment-controlled path.
//   2. Fallback: the viewer host matches DEMO_CLOUDFRONT_HOST. Only works if CloudFront
//      is configured to forward the viewer Host/Origin — often it is NOT on a shared
//      backend, which is why (1) is preferred.
// Unset / neither present => nothing is treated as demo (fail-safe).
export function isDemoEvent(event, { demoHost = process.env.DEMO_CLOUDFRONT_HOST || '' } = {}) {
  const headers = event?.headers || {};
  if (/^(1|true|yes|on)$/iu.test(String(headers['x-demo-request'] || '').trim())) {
    return true;
  }
  const host = String(demoHost).trim().toLowerCase();
  if (!host) return false;
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
