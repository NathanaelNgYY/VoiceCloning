import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { LOCAL_TEMP_ROOT } from '../config.js';
import { downloadFile } from './s3Sync.js';

export function modelCachePath(ref, { tempRoot = LOCAL_TEMP_ROOT } = {}) {
  const normalizedRef = String(ref || '').trim();
  if (!normalizedRef) return '';

  const extension = path.extname(normalizedRef);
  const basename = path.basename(normalizedRef, extension).replace(/[^A-Za-z0-9._-]/gu, '_');
  const digest = crypto.createHash('sha256').update(normalizedRef).digest('hex').slice(0, 12);
  return path.join(tempRoot, 'model_cache', `${basename}-${digest}${extension}`);
}

export async function ensureCachedModel(ref, {
  tempRoot = LOCAL_TEMP_ROOT,
  fsModule = fs,
  download = downloadFile,
} = {}) {
  const normalizedRef = String(ref || '').trim();
  if (!normalizedRef) return '';
  if (fsModule.existsSync(normalizedRef)) return normalizedRef;

  const localPath = modelCachePath(normalizedRef, { tempRoot });
  if (!fsModule.existsSync(localPath)) {
    fsModule.mkdirSync(path.dirname(localPath), { recursive: true });
    await download(normalizedRef, localPath);
  }
  return localPath;
}
