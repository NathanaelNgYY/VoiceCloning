function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/u, '');
}

const apiOrigin = trimTrailingSlash(import.meta.env.VITE_API_BASE_URL || '');

export function resolveApiPath(pathname) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return apiOrigin ? `${apiOrigin}${normalizedPath}` : normalizedPath;
}

export const API_BASE_URL = resolveApiPath('/api');
export const APP_BASENAME = import.meta.env.VITE_APP_BASENAME || '/';

// Storage mode — fetched once from backend, cached
let storageMode = null;

export async function getStorageMode() {
  if (storageMode !== null) return storageMode;
  try {
    const res = await fetch(resolveApiPath('/api/config'));
    if (res.ok) {
      const data = await res.json();
      storageMode = data.storageMode || 'local';
    } else {
      storageMode = 'local';
    }
  } catch {
    storageMode = 'local';
  }
  return storageMode;
}

export function isS3Mode() {
  return storageMode === 's3';
}
