import crypto from 'crypto';
import { inferenceServer } from './inferenceServer.js';
import { ensureCachedModel } from './modelCache.js';

function clean(value) {
  return String(value || '').trim();
}

export function readVoiceModelSnapshot(body = {}) {
  const raw = body.voice_model && typeof body.voice_model === 'object'
    ? body.voice_model
    : {};
  return {
    voiceProfileId: clean(raw.voiceProfileId || body.voiceProfileId),
    gptRef: clean(raw.gptRef),
    sovitsRef: clean(raw.sovitsRef),
    revision: clean(raw.revision),
  };
}

export function voiceModelKey(body = {}) {
  const model = readVoiceModelSnapshot(body);
  if (!model.gptRef && !model.sovitsRef) return '';
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(model))
    .digest('hex');
}

export async function ensureRequestVoiceModel(body = {}) {
  const requested = readVoiceModelSnapshot(body);
  if (!requested.gptRef && !requested.sovitsRef) return inferenceServer.getLoadedWeights();

  const [gptPath, sovitsPath] = await Promise.all([
    ensureCachedModel(requested.gptRef),
    ensureCachedModel(requested.sovitsRef),
  ]);
  const loaded = inferenceServer.getLoadedWeights();
  if (sovitsPath && loaded.sovitsPath !== sovitsPath) {
    await inferenceServer.setSoVITSWeights(sovitsPath);
  }
  const afterSoVits = inferenceServer.getLoadedWeights();
  if (gptPath && afterSoVits.gptPath !== gptPath) {
    await inferenceServer.setGPTWeights(gptPath);
  }
  return inferenceServer.getLoadedWeights();
}
