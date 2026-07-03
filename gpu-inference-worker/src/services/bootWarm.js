import fs from 'fs';
import path from 'path';
import { LOCAL_TEMP_ROOT } from '../config.js';

// The last successful warm payload is persisted at the ROOT of worker_temp — NOT
// under ref_audio_cache/ or model_cache/, both of which startupCleanup wipes on every
// boot. Keeping it here lets warmOnBoot replay it after a restart. The stored ref path
// may be an S3 key: warmReferenceAudioPaths re-downloads it, so replay survives the
// cache wipe.
export const WARM_STATE_PATH = path.join(LOCAL_TEMP_ROOT, 'last_warm.json');

// Persist the fields warmOnBoot needs to replay a warm. Best-effort: a write failure
// must never break the live warm request that triggered it.
export function recordWarmPayload(payload, { statePath = WARM_STATE_PATH, fsModule = fs } = {}) {
  try {
    const { ref_audio_path, aux_ref_audio_paths = [], text_lang = 'en', warm_text } = payload || {};
    if (!ref_audio_path) return false;
    fsModule.mkdirSync(path.dirname(statePath), { recursive: true });
    fsModule.writeFileSync(
      statePath,
      JSON.stringify({ ref_audio_path, aux_ref_audio_paths, text_lang, warm_text }),
    );
    return true;
  } catch {
    return false;
  }
}

export function readWarmPayload({ statePath = WARM_STATE_PATH, fsModule = fs } = {}) {
  try {
    if (!fsModule.existsSync(statePath)) return null;
    const parsed = JSON.parse(fsModule.readFileSync(statePath, 'utf-8'));
    return parsed && parsed.ref_audio_path ? parsed : null;
  } catch {
    return null;
  }
}

// Replay the persisted warm at boot so the first real request after a restart is hot.
// All collaborators are injected so this stays pure and testable and avoids importing
// the heavy inference route graph directly (index.js wires the real deps).
//
// Best-effort throughout: any failure is logged and swallowed — a cold-start is a
// slower first clip, never a crash. Returns true only when a warm synth actually ran.
export async function warmOnBoot({
  readPayload = readWarmPayload,
  startServer,        // () => Promise<status> — force the python server up (loads default model)
  warmReferences,     // (payload) => Promise<{ ref_audio_path, aux_ref_audio_paths }>
  runSynth,           // (body) => Promise<...> — the tiny throwaway synth (handleLiveTtsRequest)
  log = () => {},
} = {}) {
  const payload = readPayload();
  if (!payload) {
    log('[boot-warm] no persisted warm payload — skipping (first load will warm normally)');
    return false;
  }

  try {
    const status = await startServer();
    if (!status?.ready) {
      log('[boot-warm] inference server not ready after start — skipping warm');
      return false;
    }

    const warmed = await warmReferences(payload);
    await runSynth({
      ...payload,
      ref_audio_path: warmed.ref_audio_path,
      aux_ref_audio_paths: warmed.aux_ref_audio_paths,
      text: payload.warm_text || 'Ready.',
      text_lang: payload.text_lang || 'en',
    });
    log('[boot-warm] GPU path pre-warmed from persisted payload');
    return true;
  } catch (err) {
    log(`[boot-warm] failed (non-fatal, first request will be cold): ${err.message}`);
    return false;
  }
}
