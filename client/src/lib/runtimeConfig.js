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
