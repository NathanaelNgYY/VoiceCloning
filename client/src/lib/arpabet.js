const PHONEME_GRAPHEMES = {
  AA: 'ah', AE: 'a', AH: 'uh', AO: 'aw', AW: 'ow', AY: 'y', EH: 'eh', ER: 'ur',
  EY: 'ay', IH: 'ih', IY: 'ee', OW: 'oh', OY: 'oy', UH: 'uu', UW: 'oo',
  B: 'b', CH: 'ch', D: 'd', DH: 'th', F: 'f', G: 'g', HH: 'h', JH: 'j', K: 'k',
  L: 'l', M: 'm', N: 'n', NG: 'ng', P: 'p', R: 'r', S: 's', SH: 'sh', T: 't',
  TH: 'th', V: 'v', W: 'w', Y: 'y', Z: 'z', ZH: 'zh',
};

const VOWELS = new Set([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER',
  'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW',
]);

function normalizeArpabet(value) {
  return String(value || '')
    .replace(/^pron:/u, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/gu, ' ');
}

export function arpabetToReadable(arpabet) {
  const tokens = normalizeArpabet(arpabet).split(' ').filter(Boolean);
  if (tokens.length === 0) return '';

  const syllables = [];
  let onset = '';
  for (const token of tokens) {
    const phoneme = token.replace(/\d/gu, '');
    const stressed = /1/u.test(token);
    const grapheme = PHONEME_GRAPHEMES[phoneme] ?? phoneme.toLowerCase();
    if (VOWELS.has(phoneme)) {
      syllables.push({ text: onset + grapheme, stressed });
      onset = '';
    } else {
      onset += grapheme;
    }
  }
  if (onset) {
    if (syllables.length === 0) return onset; // consonants only, no vowel
    syllables[syllables.length - 1].text += onset; // trailing coda
  }

  return syllables
    .map((syllable) => (syllable.stressed ? syllable.text.toUpperCase() : syllable.text))
    .join('-');
}

export async function fetchDatamuseArpabet(word) {
  const term = String(word || '').trim();
  if (!term) return null;

  const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(term)}&md=r&max=1`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Datamuse returned ${response.status}`);

  const results = await response.json();
  if (!Array.isArray(results) || results.length === 0) return null;

  const match =
    results.find((item) => String(item.word || '').toLowerCase() === term.toLowerCase()) || results[0];
  const pron = match?.tags?.find((tag) => String(tag).startsWith('pron:'));
  const arpabet = normalizeArpabet(pron);
  return arpabet ? { arpabet } : null;
}
