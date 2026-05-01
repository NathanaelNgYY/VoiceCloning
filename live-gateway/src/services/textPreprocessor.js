// ── Number-to-words helpers ──

const NUM_ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const NUM_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const NUM_ORDINAL_ONES = [
  '', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth',
  'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth',
  'seventeenth', 'eighteenth', 'nineteenth',
];
const NUM_ORDINAL_TENS = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];

function twoDigitWords(n) {
  if (n < 20) return NUM_ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? NUM_TENS[t] : `${NUM_TENS[t]}-${NUM_ONES[o]}`;
}

function cardinalWords(n) {
  if (n === 0) return 'zero';
  if (n < 20) return NUM_ONES[n];
  if (n < 100) return twoDigitWords(n);
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    const base = `${NUM_ONES[h]} hundred`;
    return r === 0 ? base : `${base} and ${twoDigitWords(r)}`;
  }
  // "Fifteen hundred" form for 1100-1900 divisible by 100
  if (n >= 1100 && n <= 1900 && n % 100 === 0) {
    return `${twoDigitWords(n / 100)} hundred`;
  }
  if (n < 1000000) {
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    const base = `${cardinalWords(th)} thousand`;
    if (r === 0) return base;
    if (r < 100) return `${base} and ${cardinalWords(r)}`;
    return `${base} ${cardinalWords(r)}`;
  }
  return String(n);
}

function ordinalWords(n) {
  if (n < 20) return NUM_ORDINAL_ONES[n] || `${cardinalWords(n)}th`;
  if (n < 100) {
    if (n % 10 === 0) return NUM_ORDINAL_TENS[Math.floor(n / 10)];
    return `${NUM_TENS[Math.floor(n / 10)]}-${NUM_ORDINAL_ONES[n % 10]}`;
  }
  const remainder = n % 100;
  const hundredsPrefix = `${NUM_ONES[Math.floor(n / 100)]} hundred`;
  if (remainder === 0) return `${hundredsPrefix}th`;
  if (remainder < 20) return `${hundredsPrefix} and ${NUM_ORDINAL_ONES[remainder]}`;
  const tens = Math.floor(remainder / 10);
  const ones = remainder % 10;
  if (ones === 0) return `${hundredsPrefix} and ${NUM_ORDINAL_TENS[tens]}`;
  return `${hundredsPrefix} and ${NUM_TENS[tens]}-${NUM_ORDINAL_ONES[ones]}`;
}

function yearWords(n) {
  if (n === 2000) return 'two thousand';
  if (n >= 2001 && n <= 2009) return `two thousand and ${NUM_ONES[n % 10]}`;
  if (n >= 2010) return `twenty ${twoDigitWords(n - 2000)}`;
  const high = Math.floor(n / 100);
  const low = n % 100;
  if (low === 0) return `${twoDigitWords(high)} hundred`;
  if (low < 10) return `${twoDigitWords(high)} oh ${NUM_ONES[low]}`;
  return `${twoDigitWords(high)} ${twoDigitWords(low)}`;
}

function currencyWords(amountStr) {
  const cleaned = amountStr.replace(/,/g, '');
  const [intPart, decPart = '0'] = cleaned.split('.');
  const dollars = parseInt(intPart, 10) || 0;
  const cents = parseInt(decPart.padEnd(2, '0').slice(0, 2), 10);
  const dollarWord = dollars === 1 ? 'dollar' : 'dollars';
  const centWord = cents === 1 ? 'cent' : 'cents';
  if (cents === 0) return `${cardinalWords(dollars)} ${dollarWord}`;
  if (dollars === 0) return `${cardinalWords(cents)} ${centWord}`;
  return `${cardinalWords(dollars)} ${dollarWord} and ${cardinalWords(cents)} ${centWord}`;
}

export function normalizeNumbers(text) {
  let result = text;

  // 1. Ordinals: 1st, 2nd, 3rd … 21st, 22nd …
  result = result.replace(/\b(\d{1,3})(st|nd|rd|th)\b/gi, (_, n) => ordinalWords(parseInt(n, 10)));

  // 2. Currency: $50, $3.50, $1,500
  result = result.replace(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\b/g, (_, amount) => currencyWords(amount));

  // 3. Decimal numbers: 3.14, 0.5 (must run before year/cardinal steps)
  result = result.replace(/\b(\d+)\.(\d+)\b/g, (_, int, dec) =>
    `${cardinalWords(parseInt(int, 10))} point ${dec.split('').map(d => NUM_ONES[parseInt(d, 10)] || d).join(' ')}`
  );

  // 4. Years 1000–2099 (standalone 4-digit numbers in that range)
  result = result.replace(/\b(1[0-9]{3}|20[0-9]{2})\b/g, (_, yr) => yearWords(parseInt(yr, 10)));

  // 5. Comma-separated numbers: 1,500 / 10,000
  result = result.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (_, n) =>
    cardinalWords(parseInt(n.replace(/,/g, ''), 10))
  );

  // 6. Remaining plain integers up to 4 digits
  result = result.replace(/\b(\d{1,4})\b/g, (_, n) => cardinalWords(parseInt(n, 10)));

  return result;
}

// ── Text preprocessing: abbreviations, acronyms, symbols ──

const ABBREVIATIONS = {
  // Dotted country/region abbreviations (sorted longest-first by the regex builder)
  'U.S.A.': 'United States of America',
  'U.S.A': 'United States of America',
  'U.S.': 'United States',
  'U.K.': 'United Kingdom',
  'U.K': 'United Kingdom',
  // Titles & common dotted abbreviations
  'Dr.': 'Doctor',
  'Mr.': 'Mister',
  'Mrs.': 'Misses',
  'Prof.': 'Professor',
  'Sr.': 'Senior',
  'Jr.': 'Junior',
  'vs.': 'versus',
  'etc.': 'etcetera',
  'approx.': 'approximately',
  'dept.': 'department',
  'govt.': 'government',
  'no.': 'number',
  'nos.': 'numbers',
  'vol.': 'volume',
  'esp.': 'especially',
};

// Bare-caps acronyms that should be read as full words, not letter-spelled.
// Add more entries here as needed. Sorted longest-first at build time.
const ACRONYM_EXPANSIONS = {
  'USA': 'United States of America',
  'UAE': 'United Arab Emirates',
  'UK': 'United Kingdom',
  'US': 'United States',
};

const acronymExpansionPattern = new RegExp(
  '\\b(' +
  Object.keys(ACRONYM_EXPANSIONS)
    .sort((a, b) => b.length - a.length)
    .join('|') +
  ')\\b',
  'g',
);

const abbrPattern = new RegExp(
  '(?<=^|\\s)(' +
  Object.keys(ABBREVIATIONS)
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/\./g, '\\.'))
    .join('|') +
  ')(?=\\s|$)',
  'gi',
);

const ACRONYM_SKIP = new Set([
  'I', 'A', 'AM', 'PM', 'OK', 'OH', 'OR', 'IF', 'IN', 'IT', 'IS',
  'AT', 'AN', 'AS', 'BE', 'BY', 'DO', 'GO', 'HE', 'ME', 'MY', 'NO',
  'OF', 'ON', 'SO', 'TO', 'UP', 'WE',
]);

const SYMBOL_MAP = {
  '@': 'at',
  '&': 'and',
  '#': 'number',
  '%': 'percent',
  '+': 'plus',
  '=': 'equals',
};

const symbolPattern = new RegExp(
  '(?<=\\s|^)([' + Object.keys(SYMBOL_MAP).map(s => '\\' + s).join('') + '])(?=\\s|$)',
  'g',
);

export function preprocessText(text) {
  let result = text;

  // 0) Number normalisation (years, ordinals, currency, cardinals)
  result = normalizeNumbers(result);

  // 1) Dotted abbreviation expansion (Dr., U.S., U.S.A., etc.)
  result = result.replace(abbrPattern, (match) => {
    for (const [abbr, expansion] of Object.entries(ABBREVIATIONS)) {
      if (abbr.toLowerCase() === match.toLowerCase()) return expansion;
    }
    return match;
  });

  // 2) Known bare-caps acronym expansion (USA, US, UK, UAE, …)
  result = result.replace(acronymExpansionPattern, (match) => ACRONYM_EXPANSIONS[match] || match);

  // 3) Remaining acronym / initialism letter-spacing (2-5 uppercase letters)
  result = result.replace(/\b([A-Z]{2,5})\b/g, (match) => {
    if (ACRONYM_SKIP.has(match)) return match;
    return match.split('').join(' ');
  });

  // 4) Symbol expansion
  result = result.replace(symbolPattern, (match) => SYMBOL_MAP[match] || match);

  return result;
}
