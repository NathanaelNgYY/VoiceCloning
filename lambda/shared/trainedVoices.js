import { listObjects } from './s3.js';

// A voice exists once its weights do. Training writes models and nothing else —
// a saved voice-profile record only appears if someone later opens the TTS page
// and saves one — so anything that asks "which voices exist" must read the
// model files, not voice-profiles/.
const MODEL_PREFIXES = ['models/user-models/gpt/', 'models/user-models/sovits/'];
const MODEL_NAME_RE = /^(.+?)[-_]e\d+(?:[_-]s\d+)?\.(?:ckpt|pth)$/iu;

export function voiceNameFromModelKey(key) {
  const basename = String(key || '').split('/').pop() || '';
  const match = basename.match(MODEL_NAME_RE);
  return match ? match[1] : '';
}

export async function listTrainedVoiceNames(list = listObjects) {
  const listings = await Promise.all(MODEL_PREFIXES.map((prefix) => list(prefix)));
  const names = new Set();
  for (const objects of listings) {
    for (const object of objects || []) {
      const name = voiceNameFromModelKey(object?.key);
      if (name) names.add(name);
    }
  }
  return Array.from(names);
}

const EPOCH_RE = /[-_]e(\d+)(?:[_-]s(\d+))?\.(?:ckpt|pth)$/iu;

function checkpointRank(key) {
  const match = (String(key || '').split('/').pop() || '').match(EPOCH_RE);
  return match ? { epoch: Number(match[1] || 0), step: Number(match[2] || 0) } : { epoch: -1, step: -1 };
}

function isLaterCheckpoint(candidate, incumbent) {
  if (!incumbent) return true;
  const left = checkpointRank(candidate);
  const right = checkpointRank(incumbent);
  if (left.epoch !== right.epoch) return left.epoch > right.epoch;
  return left.step > right.step;
}

/**
 * The newest checkpoint of each kind for one voice — the same "latest wins"
 * choice the browser makes from the model list, done server-side so a caller
 * that only knows a voice's name can still name its weights.
 */
export async function bestModelsForVoice(voiceName, list = listObjects) {
  const wanted = String(voiceName || '').trim();
  if (!wanted) return null;

  const [gptObjects, sovitsObjects] = await Promise.all(MODEL_PREFIXES.map((prefix) => list(prefix)));
  const pick = (objects, extension) => {
    let best = '';
    for (const object of objects || []) {
      const key = String(object?.key || '');
      if (!key.toLowerCase().endsWith(extension)) continue;
      if (voiceNameFromModelKey(key) !== wanted) continue;
      if (isLaterCheckpoint(key, best)) best = key;
    }
    return best;
  };

  const gptKey = pick(gptObjects, '.ckpt');
  const sovitsKey = pick(sovitsObjects, '.pth');
  return gptKey && sovitsKey ? { gptKey, sovitsKey } : null;
}
