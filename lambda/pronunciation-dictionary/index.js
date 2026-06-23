import { uploadBuffer, getObject } from '../shared/s3.js';
import { ok, err, preflight, parseJsonBody } from '../shared/cors.js';
import { isSafePathSegment } from '../shared/paths.js';

const DICTIONARY_PATH = /^\/api\/pronunciation-dictionary\/?$/u;
const CATEGORIES = new Set(['general', 'biology', 'chemistry', 'medical', 'names', 'acronyms', 'math']);

function normalizeCategory(value) {
  const category = String(value || 'general').trim().toLowerCase();
  return CATEGORIES.has(category) && isSafePathSegment(category) ? category : 'general';
}

function dictionaryKey(category) {
  return `pronunciation-dictionary/english/${normalizeCategory(category)}.json`;
}

function normalizeWord(value) {
  return String(value || '').trim().replace(/\s+/gu, ' ');
}

function normalizeArpabet(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/gu, ' ');
}

function normalizeEntry(body, now) {
  const word = normalizeWord(body.word);
  if (!word) throw new Error('word is required');
  const category = normalizeCategory(body.category);
  return {
    id: word.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || `entry-${Date.now()}`,
    language: 'en',
    category,
    word,
    readable: String(body.readable || '').trim(),
    arpabet: normalizeArpabet(body.arpabet),
    source: String(body.source || 'admin').trim() || 'admin',
    notes: String(body.notes || '').trim(),
    updatedAt: now(),
  };
}

async function readDictionary(readObject, category) {
  try {
    const body = await readObject(dictionaryKey(category));
    const parsed = JSON.parse(body.toString('utf-8'));
    return {
      schemaVersion: 1,
      language: 'en',
      category: normalizeCategory(category),
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      updatedAt: parsed.updatedAt || '',
    };
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      return { schemaVersion: 1, language: 'en', category: normalizeCategory(category), entries: [], updatedAt: '' };
    }
    throw error;
  }
}

export function createHandler({
  readObject = getObject,
  writeObject = uploadBuffer,
  now = () => new Date().toISOString(),
} = {}) {
  return async function handler(event) {
    if (event.requestContext?.http?.method === 'OPTIONS') return preflight(event);

    const method = event.requestContext?.http?.method || 'GET';
    const routePath = event.rawPath || '';

    try {
      if (method === 'GET' && DICTIONARY_PATH.test(routePath)) {
        const category = normalizeCategory(event.queryStringParameters?.category);
        return ok(await readDictionary(readObject, category), {}, event);
      }

      if (method === 'POST' && DICTIONARY_PATH.test(routePath)) {
        const body = parseJsonBody(event);
        if (String(body.action || '').toLowerCase() === 'delete') {
          const category = normalizeCategory(body.category);
          const word = normalizeWord(body.word);
          if (!word) return err(400, 'word is required', event);
          const dictionary = await readDictionary(readObject, category);
          const entries = dictionary.entries.filter((item) => String(item.word || '').toLowerCase() !== word.toLowerCase());
          const saved = { ...dictionary, entries, updatedAt: now() };
          await writeObject(dictionaryKey(category), Buffer.from(JSON.stringify(saved), 'utf-8'), 'application/json');
          return ok({ deleted: entries.length !== dictionary.entries.length, word, dictionary: saved }, {}, event);
        }
        const entry = normalizeEntry(body, now);
        const dictionary = await readDictionary(readObject, entry.category);
        const entries = [
          entry,
          ...dictionary.entries.filter((item) => String(item.word || '').toLowerCase() !== entry.word.toLowerCase()),
        ].sort((a, b) => String(a.word || '').localeCompare(String(b.word || '')));
        const saved = { ...dictionary, entries, updatedAt: now() };
        await writeObject(dictionaryKey(entry.category), Buffer.from(JSON.stringify(saved), 'utf-8'), 'application/json');
        return ok({ entry, dictionary: saved }, {}, event);
      }

      return err(404, 'Not found', event);
    } catch (error) {
      return err(500, error.message, event);
    }
  };
}

export const handler = createHandler();
