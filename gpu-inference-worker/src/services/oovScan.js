import fs from 'fs';
import path from 'path';
import { GPT_SOVITS_ROOT } from '../config.js';
import { prepareTextForSynthesis } from './textPronunciation.js';

// The dictionaries GPT-SoVITS' english.py consults, in the same order it does:
// the CMU dict, the "fast" supplement, and the hot-override file (which holds every
// admin ARPAbet entry after a sync). A word present in ANY of these is pronounced
// from the dictionary; a word in none of them falls to g2p_en's neural predictor,
// which guesses — deterministically wrong for most medical / scientific terms.
const DICTIONARY_FILES = ['cmudict.rep', 'cmudict-fast.rep', 'engdict-hot.rep'];

// Cache the merged word set per root AND invalidate when engdict-hot.rep changes, so a
// freshly-saved override is reflected without a worker restart. Keyed by root; stores
// the set plus the hot file's mtime at load time.
const cacheByRoot = new Map();

function hotFileMtime(root) {
  try {
    return fs.statSync(path.join(root, 'GPT_SoVITS', 'text', 'engdict-hot.rep')).mtimeMs;
  } catch {
    return 0;
  }
}

function loadDictionaryWords(root) {
  const words = new Set();
  if (!root) return words;
  const dir = path.join(root, 'GPT_SoVITS', 'text');
  for (const name of DICTIONARY_FILES) {
    const file = path.join(dir, name);
    try {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf-8');
      for (const line of content.split(/\r?\n/u)) {
        const token = line.trim().split(/\s+/u)[0];
        // Strip CMU's "(2)" alternate-pronunciation suffix; uppercase to match keys.
        if (token) words.add(token.toUpperCase().replace(/\(\d+\)$/u, ''));
      }
    } catch {
      // A missing/one unreadable file must never fail the whole scan.
    }
  }
  return words;
}

function getWordSet(root) {
  const key = root ?? '';
  const mtime = hotFileMtime(root);
  const cached = cacheByRoot.get(key);
  if (cached && cached.mtime === mtime) return cached.words;
  const words = loadDictionaryWords(root);
  cacheByRoot.set(key, { words, mtime });
  return words;
}

// Mirrors en_G2p.qryword's dictionary-lookup branches WITHOUT running the neural
// predictor: a word is "covered" when the running server would pronounce it from a
// dictionary (or by a deterministic letter/possessive rule) rather than by guessing.
function isCovered(rawWord, words) {
  const w = rawWord.toLowerCase();
  if (w.length <= 1) return true; // single letter: deterministic
  if (words.has(w.toUpperCase())) return true;
  if (w.length <= 3) return true; // OOV <=3 chars is read letter-by-letter, not guessed
  const poss = /^([a-z]+)'s$/u.exec(w);
  if (poss) return isCovered(poss[1], words);
  return false;
}

/**
 * Scan a passage for words the running inference server would pronounce by neural
 * GUESS (not from the dictionary) — the deterministically-mispronounced set that only
 * an ARPAbet override in the pronunciation dictionary fixes.
 *
 * Runs the text through the SAME normalization the synthesis path uses first, so the
 * tokens checked are the tokens that actually reach g2p (compound splits, hyphen
 * splits, symbol/number expansion all applied).
 *
 * @returns {{ flagged: string[], totalWords: number, coveredWords: number, dictionaryLoaded: boolean }}
 */
export function scanOovWords(text, { root = GPT_SOVITS_ROOT } = {}) {
  const words = getWordSet(root);
  const normalized = prepareTextForSynthesis(String(text || ''));
  const tokens = normalized.match(/[A-Za-z][A-Za-z']*/gu) || [];

  const flaggedByKey = new Map(); // lowercase key -> first surface form seen
  let covered = 0;
  for (const tok of tokens) {
    if (isCovered(tok, words)) {
      covered += 1;
      continue;
    }
    const key = tok.toLowerCase();
    if (!flaggedByKey.has(key)) flaggedByKey.set(key, tok);
  }

  return {
    flagged: [...flaggedByKey.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    totalWords: tokens.length,
    coveredWords: covered,
    dictionaryLoaded: words.size > 0,
  };
}

export function _resetOovCacheForTests() {
  cacheByRoot.clear();
}
