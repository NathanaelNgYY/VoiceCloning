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
  log(`[gpu-inference-worker] Cleared ${label} at ${cacheDir}`);
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

// Reclaim leftover derived data that accumulates in worker_temp but is never cleaned:
//   - the inference/ output dir (finished synth audio — regenerated on demand)
//   - stale per-request tmp_s1_*.yaml / tmp_s2_*.json config scratch files
// All of this is safe to delete on boot: it is regenerated, and nothing persistent
// (weights, ref cache metadata, last_warm.json) matches these patterns. Best-effort —
// a failure on any one entry is logged and skipped so it never blocks startup.
const DERIVED_TEMP_FILE = /^tmp_s[12]_.*\.(ya?ml|json)$/iu;
const DERIVED_TEMP_DIRS = ['inference'];

export function clearStartupWorkerTemp({
  localTempRoot = LOCAL_TEMP_ROOT,
  fsModule = fs,
  pathModule = path,
  log = () => {},
} = {}) {
  if (!fsModule.existsSync(localTempRoot)) {
    return { cleared: false, removed: 0 };
  }

  let removed = 0;
  for (const dirName of DERIVED_TEMP_DIRS) {
    const dir = pathModule.join(localTempRoot, dirName);
    if (fsModule.existsSync(dir)) {
      try {
        fsModule.rmSync(dir, { recursive: true, force: true });
        fsModule.mkdirSync(dir, { recursive: true });
        removed += 1;
      } catch (err) {
        log(`[gpu-inference-worker] could not clear ${dir}: ${err.message}`);
      }
    }
  }

  let entries = [];
  try {
    entries = fsModule.readdirSync(localTempRoot);
  } catch { /* unreadable root — nothing to sweep */ }
  for (const entry of entries) {
    if (!DERIVED_TEMP_FILE.test(entry)) continue;
    try {
      fsModule.rmSync(pathModule.join(localTempRoot, entry), { force: true });
      removed += 1;
    } catch { /* skip locked/missing entry */ }
  }

  if (removed > 0) {
    log(`[gpu-inference-worker] Cleared ${removed} stale worker_temp derived entr${removed === 1 ? 'y' : 'ies'}`);
  }
  return { cleared: removed > 0, removed };
}
