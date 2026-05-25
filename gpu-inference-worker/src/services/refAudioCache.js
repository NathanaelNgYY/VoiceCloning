import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { LOCAL_TEMP_ROOT } from '../config.js';
import { downloadFile as defaultDownloadFile } from './s3Sync.js';

export const REF_AUDIO_CACHE_DIR = path.join(LOCAL_TEMP_ROOT, 'ref_audio_cache');

export function cachePathForS3Key(s3Key, {
  cacheRoot = REF_AUDIO_CACHE_DIR,
  pathModule = path,
} = {}) {
  const hash = crypto.createHash('sha1').update(String(s3Key || '')).digest('hex').slice(0, 12);
  return pathModule.join(cacheRoot, `${hash}_${pathModule.basename(String(s3Key || ''))}`);
}

export async function resolveRefAudioPath(refPath, {
  cacheRoot = REF_AUDIO_CACHE_DIR,
  existsSync = fs.existsSync,
  mkdirSync = fs.mkdirSync,
  downloadFile = defaultDownloadFile,
  pathModule = path,
} = {}) {
  if (!refPath || existsSync(refPath)) {
    return refPath;
  }

  const localPath = cachePathForS3Key(refPath, { cacheRoot, pathModule });
  if (!existsSync(localPath)) {
    mkdirSync(cacheRoot, { recursive: true });
    await downloadFile(refPath, localPath);
  }
  return localPath;
}

export async function resolveRefAudioParams(params = {}, deps = {}) {
  return {
    ...params,
    ref_audio_path: await resolveRefAudioPath(params.ref_audio_path, deps),
    aux_ref_audio_paths: await Promise.all(
      (params.aux_ref_audio_paths || []).map((item) => resolveRefAudioPath(item, deps)),
    ),
  };
}

export async function warmReferenceAudioPaths(params = {}, deps = {}) {
  return resolveRefAudioParams(params, deps);
}
