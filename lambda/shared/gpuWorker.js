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

async function parseResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
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
  };
}
