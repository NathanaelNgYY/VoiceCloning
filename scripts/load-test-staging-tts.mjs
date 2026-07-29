import { performance } from 'node:perf_hooks';

const concurrency = Number.parseInt(process.argv[2] || '10', 10);
const url = process.env.VCS_LOAD_TEST_URL
  || 'https://d25sg72wp8oj5g.cloudfront.net/api/live/tts-sentence';
const timeoutMs = Number.parseInt(process.env.VCS_LOAD_TEST_TIMEOUT_MS || '180000', 10);

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 500) {
  throw new Error('Concurrency must be an integer from 1 to 500.');
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

async function runRequest(index, startedAt) {
  const started = performance.now();
  try {
    const response = await fetch(`${url}?loadTest=${startedAt}-${index}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({
        voiceProfileId: 'deanvoice-v1',
        text: `Concurrent staging voice check ${index + 1}.`,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const audio = Buffer.from(await response.arrayBuffer());
    const latencyMs = performance.now() - started;
    return {
      index,
      ok: response.ok
        && response.headers.get('content-type')?.startsWith('audio/wav')
        && audio.subarray(0, 4).toString('ascii') === 'RIFF',
      status: response.status,
      contentType: response.headers.get('content-type'),
      bytes: audio.length,
      latencyMs,
    };
  } catch (error) {
    return {
      index,
      ok: false,
      status: 0,
      contentType: null,
      bytes: 0,
      latencyMs: performance.now() - started,
      error: error.message,
    };
  }
}

const runId = Date.now();
const wallStarted = performance.now();
const results = await Promise.all(
  Array.from({ length: concurrency }, (_, index) => runRequest(index, runId)),
);
const wallMs = performance.now() - wallStarted;
const successful = results.filter((result) => result.ok);
const latencies = successful.map((result) => result.latencyMs).sort((a, b) => a - b);
const failures = results
  .filter((result) => !result.ok)
  .map(({ index, status, contentType, bytes, latencyMs, error }) => ({
    index,
    status,
    contentType,
    bytes,
    latencyMs: Math.round(latencyMs),
    ...(error ? { error } : {}),
  }));
const statusCounts = Object.groupBy
  ? Object.fromEntries(
    Object.entries(Object.groupBy(results, (result) => String(result.status)))
      .map(([status, items]) => [status, items.length]),
  )
  : results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] || 0) + 1;
    return counts;
  }, {});

console.log(JSON.stringify({
  url,
  concurrency,
  startedAt: new Date(runId).toISOString(),
  wallMs: Math.round(wallMs),
  success: successful.length,
  failed: failures.length,
  statusCounts,
  latencyMs: {
    min: latencies.length ? Math.round(latencies[0]) : null,
    p50: Math.round(percentile(latencies, 0.50) ?? 0),
    p95: Math.round(percentile(latencies, 0.95) ?? 0),
    p99: Math.round(percentile(latencies, 0.99) ?? 0),
    max: latencies.length ? Math.round(latencies.at(-1)) : null,
  },
  audioBytes: {
    min: successful.length ? Math.min(...successful.map((result) => result.bytes)) : null,
    max: successful.length ? Math.max(...successful.map((result) => result.bytes)) : null,
  },
  failures,
}, null, 2));
