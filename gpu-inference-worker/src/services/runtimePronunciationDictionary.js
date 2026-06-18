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
    }))
    .filter((entry) => entry.word && entry.readable)
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

export function writeHotDictionaryOverrides(gptSovitsRoot = GPT_SOVITS_ROOT, entries = []) {
  const lines = buildHotDictionaryLines(entries);
  if (!gptSovitsRoot || lines.length === 0) return { written: false, lines: 0 };

  const filePath = path.join(gptSovitsRoot, 'GPT_SoVITS', 'text', 'engdict-hot.rep');
  if (!fs.existsSync(filePath)) return { written: false, lines: 0 };

  const current = fs.readFileSync(filePath, 'utf-8');
  const block = `${BEGIN_MARKER}\n${lines.join('\n')}\n${END_MARKER}`;
  const pattern = new RegExp(`\\n?${escapeRegExp(BEGIN_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}\\n?`, 'u');
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

  if (next !== current) fs.writeFileSync(filePath, next, 'utf-8');
  return { written: true, lines: lines.length };
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
  return writeHotDictionaryOverrides(options.gptSovitsRoot || GPT_SOVITS_ROOT, entries);
}
