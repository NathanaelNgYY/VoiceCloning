import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(scriptDir, '..');
const termsPath = path.join(workerRoot, 'pronunciation', 'datamuse-terms.txt');
const hotPath = path.join(workerRoot, 'pronunciation', 'engdict-hot.additions.rep');

function parseExisting(content) {
  const map = new Map();
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [word, ...phones] = trimmed.split(/\s+/u);
    if (word && phones.length > 0) map.set(word.toUpperCase(), phones.join(' '));
  }
  return map;
}

function normalizePronunciation(value) {
  return String(value || '')
    .replace(/^pron:/u, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/gu, ' ');
}

async function lookupWord(word) {
  const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&qe=sp&md=r&max=1`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Datamuse returned ${response.status} for ${word}`);
  const results = await response.json();
  const exact = Array.isArray(results)
    ? results.find((item) => String(item.word || '').toLowerCase() === word.toLowerCase()) || results[0]
    : null;
  const pron = exact?.tags?.find((tag) => String(tag).startsWith('pron:'));
  return normalizePronunciation(pron);
}

async function main() {
  const terms = fs.readFileSync(termsPath, 'utf-8')
    .split(/\r?\n/u)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith('#'));
  const entries = parseExisting(fs.readFileSync(hotPath, 'utf-8'));
  let updated = 0;

  for (const term of terms) {
    const pron = await lookupWord(term);
    if (!pron) {
      console.warn(`[datamuse] no pronunciation for ${term}`);
      continue;
    }
    entries.set(term.toUpperCase(), pron);
    updated += 1;
  }

  const output = Array.from(entries.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([word, pron]) => `${word} ${pron}`)
    .join('\n') + '\n';
  fs.writeFileSync(hotPath, output, 'utf-8');
  console.log(`Synced ${updated} Datamuse pronunciations into ${hotPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
