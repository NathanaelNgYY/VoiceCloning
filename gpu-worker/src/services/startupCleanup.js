import fs from 'fs';
import path from 'path';
import { LOCAL_TEMP_ROOT } from '../config.js';

function clearStartupCacheDir(cacheDir, {
  fsModule = fs,
  log = () => {},
  label = 'startup cache',
} = {}) {
  if (!fsModule.existsSync(cacheDir)) {
    return { cacheDir, cleared: false };
  }

  fsModule.rmSync(cacheDir, { recursive: true, force: true });
  fsModule.mkdirSync(cacheDir, { recursive: true });
  log(`[gpu-worker] Cleared ${label} at ${cacheDir}`);
  return { cacheDir, cleared: true };
}

export function getRefAudioCacheDir({
  localTempRoot = LOCAL_TEMP_ROOT,
  pathModule = path,
} = {}) {
  return pathModule.join(localTempRoot, 'ref_audio_cache');
}

export function getModelCacheDir({
  localTempRoot = LOCAL_TEMP_ROOT,
  pathModule = path,
} = {}) {
  return pathModule.join(localTempRoot, 'model_cache');
}

export function clearStartupRefAudioCache({
  localTempRoot = LOCAL_TEMP_ROOT,
  fsModule = fs,
  pathModule = path,
  log = () => {},
} = {}) {
  const cacheDir = getRefAudioCacheDir({ localTempRoot, pathModule });
  return clearStartupCacheDir(cacheDir, {
    fsModule,
    log,
    label: 'startup ref cache',
  });
}

export function clearStartupModelCache({
  localTempRoot = LOCAL_TEMP_ROOT,
  fsModule = fs,
  pathModule = path,
  log = () => {},
} = {}) {
  const cacheDir = getModelCacheDir({ localTempRoot, pathModule });
  return clearStartupCacheDir(cacheDir, {
    fsModule,
    log,
    label: 'startup model cache',
  });
}
