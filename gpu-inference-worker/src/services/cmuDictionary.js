import fs from 'fs';
import path from 'path';
import { GPT_SOVITS_ROOT } from '../config.js';

// GPT-SoVITS ships the CMU dictionary under GPT_SoVITS/text/. Different builds
// name it differently, so try the known candidates in order.
const CANDIDATE_FILES = ['cmudict.rep', 'cmudict-fast.rep', 'cmudict'];

const cacheByRoot = new Map(); // resolved root string -> Set<string>, populated lazily.

export function loadCmuWordSet(root = GPT_SOVITS_ROOT) {
  const words = new Set();
  if (!root) return words;
  const dir = path.join(root, 'GPT_SoVITS', 'text');
  for (const name of CANDIDATE_FILES) {
    const file = path.join(dir, name);
    try {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf-8');
      for (const line of content.split(/\r?\n/u)) {
        const token = line.trim().split(/\s+/u)[0];
        if (token) words.add(token.toUpperCase().replace(/\(\d+\)$/u, ''));
      }
      break;
    } catch {
      // Try the next candidate; never throw from a real-word check.
    }
  }
  return words;
}

export function isRealWord(word, { root = GPT_SOVITS_ROOT } = {}) {
  const key = root ?? '';
  if (!cacheByRoot.has(key)) {
    try {
      cacheByRoot.set(key, loadCmuWordSet(root));
    } catch {
      cacheByRoot.set(key, new Set());
    }
  }
  return cacheByRoot.get(key).has(String(word ?? '').toUpperCase());
}

export function _resetCmuCacheForTests() {
  cacheByRoot.clear();
}
