import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { LOCAL_TEMP_ROOT } from '../config.js';
import { downloadFile } from './s3Sync.js';
import { inferenceServer } from './inferenceServer.js';

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

async function resolveWeight(ref) {
  if (!ref) return '';
  if (fs.existsSync(ref)) return ref;

  const extension = path.extname(ref);
  const basename = path.basename(ref, extension).replace(/[^A-Za-z0-9._-]/gu, '_');
  const digest = crypto.createHash('sha256').update(ref).digest('hex').slice(0, 12);
  const localPath = path.join(LOCAL_TEMP_ROOT, 'model_cache', `${basename}-${digest}${extension}`);
  if (!fs.existsSync(localPath)) {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    await downloadFile(ref, localPath);
  }
  return localPath;
}

export async function ensureRequestVoiceModel(body = {}) {
  const requested = readVoiceModelSnapshot(body);
  if (!requested.gptRef && !requested.sovitsRef) return inferenceServer.getLoadedWeights();

  const [gptPath, sovitsPath] = await Promise.all([
    resolveWeight(requested.gptRef),
    resolveWeight(requested.sovitsRef),
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
