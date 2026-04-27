import path from 'path';

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/u;

export function isSafePathSegment(value) {
  return SAFE_PATH_SEGMENT.test(String(value || ''));
}

export function sanitizeFilename(filename, fallbackBase = 'file') {
  const original = String(filename || '');
  const ext = path.extname(original).replace(/[^A-Za-z0-9.]/gu, '').slice(0, 16);
  const base = path
    .basename(original, path.extname(original))
    .replace(/[^A-Za-z0-9._-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  return `${base || fallbackBase}${ext}`;
}
