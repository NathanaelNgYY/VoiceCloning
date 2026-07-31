function baseUrl() {
  const GPU_WORKER_URL = process.env.GPU_WORKER_URL || '';
  if (!GPU_WORKER_URL) {
    throw new Error('GPU_WORKER_URL env var is not set');
  }
  return GPU_WORKER_URL.replace(/\/+$/u, '');
}

function publicBaseUrl() {
  const url = process.env.GPU_WORKER_PUBLIC_URL || process.env.GPU_WORKER_URL || '';
  if (!url) {
    throw new Error('GPU_WORKER_PUBLIC_URL or GPU_WORKER_URL env var is not set');
  }
  return url.replace(/\/+$/u, '');
}

function inferenceBaseUrl() {
  const url = process.env.INFERENCE_WORKER_URL || process.env.GPU_WORKER_URL || '';
  if (!url) {
    throw new Error('INFERENCE_WORKER_URL env var is not set');
  }
  return url.replace(/\/+$/u, '');
}

function inferencePublicBaseUrl() {
  const url = process.env.INFERENCE_WORKER_PUBLIC_URL
    || process.env.INFERENCE_WORKER_URL
    || process.env.GPU_WORKER_PUBLIC_URL
    || process.env.GPU_WORKER_URL
    || '';
  if (!url) {
    throw new Error('No inference worker public URL configured');
  }
  return url.replace(/\/+$/u, '');
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function upstreamError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function capacityRetryBudgetMs() {
  const parsed = Number.parseInt(process.env.INFERENCE_CAPACITY_RETRY_MS || '30000', 10);
  return Number.isFinite(parsed) ? Math.min(60_000, Math.max(0, parsed)) : 30_000;
}

function isCapacityStatus(status) {
  return status === 429 || status === 503;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchInferenceWithCapacityRetry(routePath, options, {
  fetchImpl = fetch,
  waitImpl = wait,
  now = Date.now,
} = {}) {
  const startedAt = now();
  const budgetMs = capacityRetryBudgetMs();
  let attempt = 0;
  while (true) {
    const response = await fetchImpl(`${inferenceBaseUrl()}${routePath}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(attempt > 0 ? { 'X-VCS-Capacity-Retry': String(attempt) } : {}),
      },
    });
    if (!isCapacityStatus(response.status)) return response;

    const elapsed = now() - startedAt;
    const retryAfterSeconds = Number(response.headers.get('retry-after'));
    const exponentialMs = Math.min(2_000, 250 * (2 ** attempt));
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(5_000, retryAfterSeconds * 1_000)
      : exponentialMs;
    if (elapsed + delayMs > budgetMs) return response;

    // Consume the response before retrying so Node can reuse the ALB connection.
    await response.arrayBuffer();
    await waitImpl(delayMs);
    attempt += 1;
  }
}

export async function gpuPost(routePath, body = {}) {
  const response = await fetch(`${baseUrl()}${routePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await parseResponse(response);
  if (!response.ok) {
    throw new Error(data.error || data.message || `GPU Worker POST ${routePath} failed (${response.status})`);
  }
  return data;
}

export async function gpuGet(routePath) {
  const response = await fetch(`${baseUrl()}${routePath}`);
  const data = await parseResponse(response);
  if (!response.ok) {
    throw new Error(data.error || data.message || `GPU Worker GET ${routePath} failed (${response.status})`);
  }
  return data;
}

export function gpuPublicUrl(routePath) {
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${publicBaseUrl()}${normalizedPath}`;
}

export async function gpuPostBinary(routePath, body = {}) {
  const response = await fetch(`${baseUrl()}${routePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await parseResponse(response);
    throw new Error(data.error || data.message || `GPU Worker POST ${routePath} failed (${response.status})`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    queueWaitMs: response.headers.get('x-synthesis-queue-wait-ms'),
  };
}

export async function inferencePost(routePath, body = {}, extraHeaders = {}) {
  const response = await fetch(`${inferenceBaseUrl()}${routePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  const data = await parseResponse(response);
  if (!response.ok) {
    throw upstreamError(data.error || data.message || `Inference Worker POST ${routePath} failed (${response.status})`, response.status);
  }
  return data;
}

export async function inferenceGet(routePath) {
  const response = await fetch(`${inferenceBaseUrl()}${routePath}`);
  const data = await parseResponse(response);
  if (!response.ok) {
    throw upstreamError(data.error || data.message || `Inference Worker GET ${routePath} failed (${response.status})`, response.status);
  }
  return data;
}

export function inferencePublicUrl(routePath) {
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${inferencePublicBaseUrl()}${normalizedPath}`;
}

export async function inferencePostBinary(routePath, body = {}, extraHeaders = {}) {
  const response = await fetchInferenceWithCapacityRetry(routePath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await parseResponse(response);
    throw upstreamError(data.error || data.message || `Inference Worker POST ${routePath} failed (${response.status})`, response.status);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}

export async function inferenceGetBinary(routePath) {
  const response = await fetch(`${inferenceBaseUrl()}${routePath}`);
  if (!response.ok) {
    const data = await parseResponse(response);
    throw upstreamError(data.error || data.message || `Inference Worker GET ${routePath} failed (${response.status})`, response.status);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}
