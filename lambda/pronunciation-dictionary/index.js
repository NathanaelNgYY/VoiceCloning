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

function normalizeSynthesisAlias(value, { strict = false } = {}) {
  const alias = String(value || '').trim().replace(/\s+/gu, ' ');
  if (!alias) return '';
  if (alias.length > 80) {
    if (!strict) return '';
    throw new Error('synthesisAlias must be 80 characters or fewer');
  }
  if (!/^[A-Za-z]+(?:[ '-][A-Za-z]+)+$/u.test(alias)) {
    if (!strict) return '';
    throw new Error('synthesisAlias must contain at least two English word parts using only letters, spaces, apostrophes, or hyphens');
  }
  return alias;
}

function normalizeEntry(body, now) {
  const word = normalizeWord(body.word);
  if (!word) throw new Error('word is required');
  const category = normalizeCategory(body.category);
  const arpabet = normalizeArpabet(body.arpabet);
  const synthesisAlias = normalizeSynthesisAlias(body.synthesisAlias, { strict: true });
  if (!arpabet) throw new Error('arpabet is required; readable pronunciations are no longer supported');
  return {
    id: word.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || `entry-${Date.now()}`,
    language: 'en',
    category,
    word,
    arpabet,
    ...(synthesisAlias ? { synthesisAlias } : {}),
    // Opt-in only: the runtime dictionary contains thousands of general entries,
    // so ARPAbet presence alone must never make a word a strict phoneme gate.
    verifyPhonemes: body.verifyPhonemes === true,
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
      entries: (Array.isArray(parsed.entries) ? parsed.entries : [])
        .map((entry) => {
          const synthesisAlias = normalizeSynthesisAlias(entry.synthesisAlias);
          const { synthesisAlias: _storedAlias, ...rest } = entry;
          return {
            ...rest,
            category: normalizeCategory(entry.category || category),
            arpabet: normalizeArpabet(entry.arpabet),
            ...(synthesisAlias ? { synthesisAlias } : {}),
          };
        })
        .filter((entry) => normalizeWord(entry.word) && entry.arpabet)
        .map(({ readable: _readable, ...entry }) => entry),
      updatedAt: parsed.updatedAt || '',
    };
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      return { schemaVersion: 1, language: 'en', category: normalizeCategory(category), entries: [], updatedAt: '' };
    }
    throw error;
  }
}

async function readAllDictionaries(readObject, { dedupe = true } = {}) {
  const dictionaries = await Promise.all([...CATEGORIES].map((category) => readDictionary(readObject, category)));
  const byCategory = new Map(dictionaries.map((dictionary) => [dictionary.category, dictionary]));
  if (!dedupe) return byCategory;
  const winnerByWord = new Map();
  for (const dictionary of dictionaries) {
    for (const entry of dictionary.entries) {
      const key = normalizeWord(entry.word).toLowerCase();
      const current = winnerByWord.get(key);
      const entryTime = Date.parse(String(entry.updatedAt || '')) || 0;
      const currentTime = Date.parse(String(current?.entry?.updatedAt || '')) || 0;
      if (!current || entryTime > currentTime
        || (entryTime === currentTime && dictionary.category.localeCompare(current.category) < 0)) {
        winnerByWord.set(key, { category: dictionary.category, entry });
      }
    }
  }
  for (const dictionary of dictionaries) {
    dictionary.entries = dictionary.entries.filter((entry) => (
      winnerByWord.get(normalizeWord(entry.word).toLowerCase())?.entry === entry
    ));
  }
  return byCategory;
}

async function writeDictionary(writeObject, dictionary) {
  await writeObject(
    dictionaryKey(dictionary.category),
    Buffer.from(JSON.stringify(dictionary), 'utf-8'),
    'application/json',
  );
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
        const dictionaries = await readAllDictionaries(readObject);
        return ok(dictionaries.get(category), {}, event);
      }

      if (method === 'POST' && DICTIONARY_PATH.test(routePath)) {
        const body = parseJsonBody(event);
        if (String(body.action || '').toLowerCase() === 'delete') {
          const category = normalizeCategory(body.category);
          const word = normalizeWord(body.word);
          if (!word) return err(400, 'word is required', event);
          const dictionaries = await readAllDictionaries(readObject, { dedupe: false });
          let deleted = false;
          const writes = [];
          for (const dictionary of dictionaries.values()) {
            const entries = dictionary.entries.filter((item) => String(item.word || '').toLowerCase() !== word.toLowerCase());
            if (entries.length === dictionary.entries.length) continue;
            deleted = true;
            const saved = { ...dictionary, entries, updatedAt: now() };
            dictionaries.set(dictionary.category, saved);
            writes.push(writeDictionary(writeObject, saved));
          }
          await Promise.all(writes);
          return ok({ deleted, word, dictionary: dictionaries.get(category) }, {}, event);
        }
        if (!normalizeArpabet(body.arpabet)) {
          return err(400, 'arpabet is required; readable pronunciations are no longer supported', event);
        }
        try {
          normalizeSynthesisAlias(body.synthesisAlias, { strict: true });
        } catch (error) {
          return err(400, error.message, event);
        }
        const entry = normalizeEntry(body, now);
        const dictionaries = await readAllDictionaries(readObject, { dedupe: false });
        for (const dictionary of dictionaries.values()) {
          dictionary.entries = dictionary.entries.filter(
            (item) => String(item.word || '').toLowerCase() !== entry.word.toLowerCase(),
          );
        }
        const dictionary = dictionaries.get(entry.category);
        const entries = [
          entry,
          ...dictionary.entries,
        ].sort((a, b) => String(a.word || '').localeCompare(String(b.word || '')));
        const saved = { ...dictionary, entries, updatedAt: now() };
        dictionaries.set(entry.category, saved);
        await Promise.all([...dictionaries.values()].map((item) => writeDictionary(writeObject, item)));
        return ok({ entry, dictionary: saved }, {}, event);
      }

      return err(404, 'Not found', event);
    } catch (error) {
      return err(500, error.message, event);
    }
  };
}

export const handler = createHandler();
