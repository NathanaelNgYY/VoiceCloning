import path from 'path';

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/u;

export function isSafePathSegment(value) {
  return SAFE_PATH_SEGMENT.test(String(value || ''));
}

export function isPathInside(candidatePath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function sanitizeFilename(filename, fallbackBase = 'file') {
  const ext = path.extname(filename || '').replace(/[^A-Za-z0-9.]/gu, '').slice(0, 16);
  const base = path
    .basename(filename || '', path.extname(filename || ''))
    .replace(/[^A-Za-z0-9._-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');

  return `${base || fallbackBase}${ext}`;
}
