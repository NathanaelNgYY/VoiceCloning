import fs from 'fs';
import path from 'path';
import { getObject, listObjects } from './s3Storage.js';
import { GPT_SOVITS_ROOT } from '../config.js';

const DICTIONARY_PREFIX = 'pronunciation-dictionary/english/';
const CACHE_TTL_MS = 60_000;
const BEGIN_MARKER = '# BEGIN ADMIN PRONUNCIATION DICTIONARY';
const END_MARKER = '# END ADMIN PRONUNCIATION DICTIONARY';

let cachedEntries = [];
let cacheLoadedAt = 0;

function normalizeWord(value) {
  return String(value || '').trim();
}

function normalizeArpabet(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/gu, ' ');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function applyReadableOverrides(text, entries = []) {
  let result = String(text || '');
  const readableEntries = entries
    .map((entry) => ({
      word: normalizeWord(entry.word),
      readable: String(entry.readable || '').trim(),
      arpabet: normalizeArpabet(entry.arpabet),
    }))
    .filter((entry) => entry.word && entry.readable && !entry.arpabet)
    .sort((a, b) => b.word.length - a.word.length);

  for (const entry of readableEntries) {
    const pattern = new RegExp(`\\b${escapeRegExp(entry.word)}\\b`, 'giu');
    result = result.replace(pattern, entry.readable);
  }
  return result;
}

export function buildHotDictionaryLines(entries = []) {
  const lines = [];
  const seen = new Set();
  for (const entry of entries) {
    const word = normalizeWord(entry.word).toUpperCase().replace(/[^A-Z0-9']/gu, '');
    const arpabet = normalizeArpabet(entry.arpabet);
    if (!word || !arpabet || seen.has(word)) continue;
    seen.add(word);
    lines.push(`${word} ${arpabet}`);
  }
  return lines;
}

function hotDictionaryWords(entries = []) {
  return new Set(buildHotDictionaryLines(entries).map((line) => line.split(/\s+/u)[0]));
}

// GPT-SoVITS' english.py only reads engdict-hot.rep when it has to rebuild the
// compiled dictionary; if engdict_cache.pickle already exists it loads that and
// never looks at the hot file. So a hot-file edit is silently ignored (even across
// restarts) until the cache is invalidated. Deleting the stale pickle forces a
// rebuild on the next engine start, which is the only path that overlays the hot
// entries. namedict_cache.pickle is for the name dictionary and is left alone.
//
// `force` removes the pickle outright (we just rewrote the hot file). Otherwise it
// is removed only when it is OLDER than the hot file — which self-heals an already
// up-to-date hot file whose entries never made it into a pre-existing stale cache.
function invalidateCompiledDictionaryCache(gptSovitsRoot, { force = false } = {}) {
  if (!gptSovitsRoot) return false;
  const textDir = path.join(gptSovitsRoot, 'GPT_SoVITS', 'text');
  const cachePath = path.join(textDir, 'engdict_cache.pickle');
  const hotPath = path.join(textDir, 'engdict-hot.rep');
  try {
    if (!fs.existsSync(cachePath)) return false;
    if (!force) {
      const cacheMtime = fs.statSync(cachePath).mtimeMs;
      const hotMtime = fs.existsSync(hotPath) ? fs.statSync(hotPath).mtimeMs : 0;
      if (cacheMtime >= hotMtime) return false; // cache already newer than hot edits
    }
    fs.unlinkSync(cachePath);
    return true;
  } catch (error) {
    console.warn(`[pronunciation] could not invalidate engdict cache: ${error.message}`);
  }
  return false;
}

export function writeHotDictionaryOverrides(gptSovitsRoot = GPT_SOVITS_ROOT, entries = []) {
  const lines = buildHotDictionaryLines(entries);
  if (!gptSovitsRoot) return { written: false, lines: 0, changed: false, cacheInvalidated: false };

  const filePath = path.join(gptSovitsRoot, 'GPT_SoVITS', 'text', 'engdict-hot.rep');
  if (!fs.existsSync(filePath)) return { written: false, lines: 0, changed: false, cacheInvalidated: false };

  const current = fs.readFileSync(filePath, 'utf-8');
  const pattern = new RegExp(`\\n?${escapeRegExp(BEGIN_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}\\n?`, 'u');
  if (lines.length === 0) {
    const next = `${current.replace(pattern, '\n').trimEnd()}\n`;
    const changed = next !== current;
    if (changed) fs.writeFileSync(filePath, next, 'utf-8');
    const cacheInvalidated = invalidateCompiledDictionaryCache(gptSovitsRoot, { force: changed });
    return { written: true, lines: 0, changed, cacheInvalidated };
  }

  const block = `${BEGIN_MARKER}\n${lines.join('\n')}\n${END_MARKER}`;
  const words = hotDictionaryWords(entries);
  const withoutManagedBlock = current.replace(pattern, '\n');
  const withoutAdminWords = withoutManagedBlock
    .split(/\r?\n/u)
    .filter((line) => {
      const word = line.trim().split(/\s+/u)[0]?.toUpperCase();
      return !words.has(word);
    })
    .join('\n');
  const next = `${withoutAdminWords.trimEnd()}\n\n${block}\n`;

  const changed = next !== current;
  if (changed) fs.writeFileSync(filePath, next, 'utf-8');
  // The hot entries only reach g2p after the compiled cache is rebuilt. Force the
  // drop when we just rewrote the file; otherwise still drop a cache that predates
  // the hot file so an already-current hot file self-heals. The engine restart in
  // /inference/start then does the rebuild.
  const cacheInvalidated = invalidateCompiledDictionaryCache(gptSovitsRoot, { force: changed });
  return { written: true, lines: lines.length, changed, cacheInvalidated };
}

export async function loadRuntimePronunciationEntries({
  listStoredObjects = listObjects,
  readObject = getObject,
  force = false,
} = {}) {
  const now = Date.now();
  if (!force && now - cacheLoadedAt < CACHE_TTL_MS) return cachedEntries;

  try {
    const objects = await listStoredObjects(DICTIONARY_PREFIX);
    const entries = [];
    for (const object of objects.filter((item) => item.key.endsWith('.json'))) {
      const body = await readObject(object.key);
      const parsed = JSON.parse(body.toString('utf-8'));
      if (Array.isArray(parsed.entries)) entries.push(...parsed.entries);
    }
    cachedEntries = entries;
    cacheLoadedAt = now;
    console.log(`[pronunciation] loaded ${entries.length} admin dictionary entries from S3 (${DICTIONARY_PREFIX})`);
    return cachedEntries;
  } catch (error) {
    console.warn(`[pronunciation] Could not load admin dictionary: ${error.message}`);
    cacheLoadedAt = now;
    return cachedEntries;
  }
}

export async function prepareTextWithRuntimeDictionary(text, options = {}) {
  const entries = await loadRuntimePronunciationEntries(options);
  return applyReadableOverrides(text, entries);
}

export async function syncHotDictionaryOverrides(options = {}) {
  const entries = await loadRuntimePronunciationEntries({ ...options, force: true });
  const result = writeHotDictionaryOverrides(options.gptSovitsRoot || GPT_SOVITS_ROOT, entries);
  if (result.written) {
    console.log(
      `[pronunciation] hot dictionary sync: ${result.lines} ARPAbet line(s) from ${entries.length} admin entr(ies); `
      + `hotFileChanged=${result.changed} compiledCacheInvalidated=${result.cacheInvalidated}`,
    );
  } else {
    console.warn(
      '[pronunciation] hot dictionary sync SKIPPED — engdict-hot.rep not found under '
      + `${options.gptSovitsRoot || GPT_SOVITS_ROOT || '(unset GPT_SOVITS_ROOT)'} — admin ARPAbet entries are NOT applied`,
    );
  }
  return { ...result, entryCount: entries.length };
}
