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
