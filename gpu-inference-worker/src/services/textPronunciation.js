// Shared English text normalization before text reaches GPT-SoVITS.
// Dictionary overrides live in gpu-inference-worker/pronunciation/engdict-hot.additions.rep.

const COMPOUND_WORD_SPLITS = {
  audiobook: 'audio book',
  audiobooks: 'audio books',
  textbook: 'text book',
  textbooks: 'text books',
  notebook: 'note book',
  notebooks: 'note books',
  handbook: 'hand book',
  handbooks: 'hand books',
  coursework: 'course work',
  framework: 'frame work',
  frameworks: 'frame works',
  workflow: 'work flow',
  workflows: 'work flows',
  feedback: 'feed back',
  outcome: 'out come',
  outcomes: 'out comes',
  overview: 'over view',
  throughout: 'through out',
  widespread: 'wide spread',
  breakthrough: 'break through',
  breakthroughs: 'break throughs',
  underlying: 'under lying',
  overlapping: 'over lapping',
  mainstream: 'main stream',
  standalone: 'stand alone',
  bloodstream: 'blood stream',
  bloodwork: 'blood work',
  heartbeat: 'heart beat',
  heartburn: 'heart burn',
  breastbone: 'breast bone',
  backbone: 'back bone',
  kneecap: 'knee cap',
  eardrum: 'ear drum',
  eyeball: 'eye ball',
  eyelid: 'eye lid',
  fingertip: 'finger tip',
  footprint: 'foot print',
  windpipe: 'wind pipe',
  birthmark: 'birth mark',
  headache: 'head ache',
  headaches: 'head aches',
  backache: 'back ache',
  toothache: 'tooth ache',
  stomachache: 'stomach ache',
  nosebleed: 'nose bleed',
  sunburn: 'sun burn',
  heatstroke: 'heat stroke',
  frostbite: 'frost bite',
  outbreak: 'out break',
  outbreaks: 'out breaks',
  onset: 'on set',
  setback: 'set back',
  setbacks: 'set backs',
  fallout: 'fall out',
  flareup: 'flare up',
  burnout: 'burn out',
  healthcare: 'health care',
  aftercare: 'after care',
  bloodtest: 'blood test',
  checkup: 'check up',
  checkups: 'check ups',
  followup: 'follow up',
  followups: 'follow ups',
  bypass: 'by pass',
  cutoff: 'cut off',
  cutoffs: 'cut offs',
  dosage: 'dose age',
  intake: 'in take',
  output: 'out put',
  uptake: 'up take',
  lifespan: 'life span',
  timeframe: 'time frame',
  timeframes: 'time frames',
  guideline: 'guide line',
  guidelines: 'guide lines',
  baseline: 'base line',
  drugstore: 'drug store',
  painkiller: 'pain killer',
  painkillers: 'pain killers',
  antibiotic: 'anti biotic',
  antibiotics: 'anti biotics',
  underdose: 'under dose',
  overdose: 'over dose',
  overdoses: 'over doses',
  sideeffect: 'side effect',
  benchmark: 'bench mark',
  benchmarks: 'bench marks',
  counterpart: 'counter part',
  counterparts: 'counter parts',
  dataset: 'data set',
  datasets: 'data sets',
  database: 'data base',
  databases: 'data bases',
  screenshot: 'screen shot',
  screenshots: 'screen shots',
  classroom: 'class room',
  classrooms: 'class rooms',
  homework: 'home work',
  bookshelf: 'book shelf',
  whiteboard: 'white board',
  whiteboards: 'white boards',
  blackboard: 'black board',
  slideshow: 'slide show',
  powerpoint: 'power point',
  worksheet: 'work sheet',
  worksheets: 'work sheets',
  undergraduate: 'under graduate',
  undergraduates: 'under graduates',
  postgraduate: 'post graduate',
  postgraduates: 'post graduates',
  biomolecule: 'bio molecule',
  biomolecules: 'bio molecules',
};

const ABBREVIATIONS = {
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
  'e.g.': 'for example',
  'i.e.': 'that is',
  'fig.': 'figure',
  'eq.': 'equation',
  'ch.': 'chapter',
  'sec.': 'section',
  'min.': 'minutes',
  'max.': 'maximum',
  'misc.': 'miscellaneous',
  'ref.': 'reference',
  'refs.': 'references',
  'ex.': 'example',
  'w/': 'with',
  'w/o': 'without',
  'b/c': 'because',
};

// Spoken names for standalone capital letters. A lone letter (e.g. the "G" left
// behind after "ΔG" -> "delta G") is otherwise handed to GPT-SoVITS's English
// normalizer, which guesses the pronunciation and gets it wrong ("G" -> "jay").
// Rewriting to the letter-NAME word routes it through the CMU/hot dictionary,
// where engdict-hot.additions.rep pins the exact ARPAbet. "A" and "I" are real
// words (article / pronoun) and are deliberately left untouched.
const LETTER_NAMES = {
  B: 'bee', C: 'cee', D: 'dee', E: 'ee', F: 'eff', G: 'gee', H: 'aitch',
  J: 'jay', K: 'kay', L: 'el', M: 'em', N: 'en', O: 'oh', P: 'pee', Q: 'cue',
  R: 'ar', S: 'ess', T: 'tee', U: 'yoo', V: 'vee', W: 'double you', X: 'ex',
  Y: 'wy', Z: 'zee',
};

// A and I are normally real words, but inside an explicit initialism they must be
// letter names. Formula suffixes such as `(CH2O)n` also need an explicit letter name,
// while ordinary standalone A/I remain real words.
const INITIALISM_LETTER_NAMES = {
  ...LETTER_NAMES,
  A: 'ay',
  I: 'eye',
};

// In this cloned voice the dictionary spelling "cee" can stretch into two vowel
// beats ("see-ee"). Formula C uses the ordinary word "see", whose familiar lexical
// pronunciation stays one syllable. Other initialisms retain the established map.
const FORMULA_LETTER_NAMES = {
  ...INITIALISM_LETTER_NAMES,
  C: 'see',
};

const ELEMENT_SYMBOLS = new Set([
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
  'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
  'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
  'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
  'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn',
  'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd',
  'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb',
  'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
  'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th',
  'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm',
  'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds',
  'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og',
]);

const SMALL_NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS_NUMBER_WORDS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function formulaNumberToWords(raw) {
  const digits = String(raw || '');
  const value = Number.parseInt(digits, 10);
  if (!/^\d+$/u.test(digits)) return digits;
  // Leading zeroes and unusually large subscripts are notation, not ordinary
  // quantities; spell their digits individually instead of changing their value.
  if ((digits.length > 1 && digits.startsWith('0')) || value > 999) {
    return digits.split('').map((digit) => SMALL_NUMBER_WORDS[Number(digit)]).join(' ');
  }
  if (value < 20) return SMALL_NUMBER_WORDS[value];
  if (value < 100) {
    const ones = value % 10;
    return `${TENS_NUMBER_WORDS[Math.floor(value / 10)]}${ones ? ` ${SMALL_NUMBER_WORDS[ones]}` : ''}`;
  }
  const remainder = value % 100;
  return `${SMALL_NUMBER_WORDS[Math.floor(value / 100)]} hundred${remainder ? ` ${formulaNumberToWords(String(remainder))}` : ''}`;
}

function parseFormulaCore(core) {
  const parts = [];
  let index = 0;
  while (index < core.length) {
    const symbolMatch = /^[A-Z][a-z]?/u.exec(core.slice(index));
    if (!symbolMatch || !ELEMENT_SYMBOLS.has(symbolMatch[0])) return null;
    const symbol = symbolMatch[0];
    index += symbol.length;
    const countMatch = /^\d+/u.exec(core.slice(index));
    const count = countMatch?.[0] || '';
    index += count.length;
    parts.push({ symbol, count });
  }
  return parts;
}

function isUnambiguousFormula(core, parts, { grouped = false } = {}) {
  if (!parts || parts.length === 0) return false;
  if (grouped || /\d/u.test(core)) return true;
  // A single alphabetic element symbol is not enough evidence on its own: ordinary
  // sentence words such as "In", "As", "At", and "He" otherwise become spoken
  // letter names. Multi-symbol compounds (NaCl) and longer all-cap element
  // sequences (COOH) remain unambiguous without nearby chemistry prose.
  return parts.length >= 2 && (/[a-z]/u.test(core) || core.length >= 3);
}

function renderFormulaParts(parts) {
  const groups = parts.map(({ symbol, count }) => {
    const letters = [...symbol.toUpperCase()]
      .map((letter) => FORMULA_LETTER_NAMES[letter] || letter.toLowerCase())
      .join(' ');
    return count ? `${letters} ${formulaNumberToWords(count)}` : letters;
  });
  // Keep each symbol attached to its subscript ("cee six"), with one natural
  // phrase boundary between counted element groups. Unsubscripted runs such as
  // COOH remain continuous instead of sounding like a spelling exercise.
  const hasSubscript = parts.some(({ count }) => Boolean(count));
  return groups.join(hasSubscript ? ', ' : ' ');
}

function expandChemicalFormulaCandidate(candidate) {
  const grouped = /^\(([A-Za-z0-9]+)\)(n|\d+)?$/u.exec(candidate);
  if (grouped) {
    const parts = parseFormulaCore(grouped[1]);
    if (!isUnambiguousFormula(grouped[1], parts, { grouped: true })) return candidate;
    const suffix = grouped[2] === 'n'
      ? INITIALISM_LETTER_NAMES.N
      : (grouped[2] ? formulaNumberToWords(grouped[2]) : '');
    return `open parenthesis, ${renderFormulaParts(parts)}, close parenthesis${suffix ? `, ${suffix}` : ''}`;
  }

  const parts = parseFormulaCore(candidate);
  return isUnambiguousFormula(candidate, parts) ? renderFormulaParts(parts) : candidate;
}

// Conservative token matcher followed by element-symbol validation. Validation is
// what prevents ordinary words/acronyms (ATP, NASA, Carbon) from being rewritten.
function expandChemicalFormulas(text) {
  return String(text || '').replace(
    /(^|[^A-Za-z0-9])(\([A-Z][A-Za-z0-9]*\)(?:n|\d+)?|[A-Z][A-Za-z0-9]*)(?=$|[^A-Za-z0-9])/gu,
    (_match, prefix, candidate) => `${prefix}${expandChemicalFormulaCandidate(candidate)}`,
  );
}
const SYMBOL_MAP = {
  '@': 'at',
  '&': 'and',
  '#': 'number',
  '%': 'percent',
  '+': 'plus',
  '=': 'equals',
  '<': 'less than',
  '>': 'greater than',
  '*': 'times',
};

// Numeric notation GPT-SoVITS's internal English normalizer handles unpredictably —
// and which the ASR verifier can't check at all (digit-bearing tokens are excluded
// from coverage as un-verifiable). Expanding them into words makes the pronunciation
// deterministic AND turns them into countable words the skip/clip verifier protects.

// Ordinals 1st–12th. Whisper writes these back as words in running speech; the
// verifier also canonicalizes a re-abbreviated "1st" back to "first" (wordCoverage),
// so the expansion never reads as a missing word. 13th+ is left alone: compound
// ordinals ("twenty-first") round-trip through ASR too inconsistently to verify.
const ORDINAL_WORDS = {
  '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth',
  '5th': 'fifth', '6th': 'sixth', '7th': 'seventh', '8th': 'eighth',
  '9th': 'ninth', '10th': 'tenth', '11th': 'eleventh', '12th': 'twelfth',
};

// Units directly after a number. [abbrev pattern, singular, plural]; "1 mg" says
// "1 milligram", any other count is plural. mmHg is handled in the same pass.
const NUMBER_UNITS = [
  ['mmHg', 'millimeters of mercury', 'millimeters of mercury'],
  ['mcg|µg|ug', 'microgram', 'micrograms'],
  ['mg', 'milligram', 'milligrams'],
  ['ml|mL', 'milliliter', 'milliliters'],
  ['kg', 'kilogram', 'kilograms'],
  ['km', 'kilometer', 'kilometers'],
  ['cm', 'centimeter', 'centimeters'],
  ['mm', 'millimeter', 'millimeters'],
  ['bpm', 'beats per minute', 'beats per minute'],
  ['hrs', 'hours', 'hours'],
  ['hr', 'hour', 'hours'],
  ['mins', 'minutes', 'minutes'],
];

// Roman numerals ONLY after a classifier word ("stage IV", "type II"), where they are
// unambiguous — a bare "IV" (intravenous) or "I" (pronoun) must not be touched.
// Digits, not words, so Whisper's own "stage 4" output matches at verification.
const ROMAN_AFTER_CLASSIFIER = /\b(type|stage|phase|grade|class)\s+(III|II|IV|V|I)\b/g;
const ROMAN_VALUES = { I: '1', II: '2', III: '3', IV: '4', V: '5' };

function expandNumericNotation(text) {
  let result = text
    // "50%" (attached) — the standalone-symbol map below only catches spaced "%".
    .replace(/(\d)\s*%/g, '$1 percent');
  for (const [abbrev, singular, plural] of NUMBER_UNITS) {
    // Word chosen by the full number before the unit: exactly "1" is singular.
    result = result.replace(
      new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(?:${abbrev})\\b`, 'g'),
      (_m, num) => `${num} ${num === '1' ? singular : plural}`,
    );
  }
  result = result.replace(
    new RegExp(`\\b(${Object.keys(ORDINAL_WORDS).join('|')})\\b`, 'g'),
    (m) => ORDINAL_WORDS[m],
  );
  return result.replace(ROMAN_AFTER_CLASSIFIER, (_m, kw, numeral) => `${kw} ${ROMAN_VALUES[numeral]}`);
}

const abbrPattern = new RegExp(
  '(?<=^|\\s)(' +
  Object.keys(ABBREVIATIONS)
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/\./g, '\\.'))
    .join('|') +
  ')(?=\\s|$)',
  'gi',
);

const symbolPattern = new RegExp(
  '(?<=\\s|^)([' + Object.keys(SYMBOL_MAP).map(s => '\\' + s).join('') + '])(?=\\s|$)',
  'g',
);

function splitCompoundWords(text) {
  const pattern = new RegExp(`\\b(${Object.keys(COMPOUND_WORD_SPLITS).join('|')})\\b`, 'gi');
  return text.replace(pattern, (match) => COMPOUND_WORD_SPLITS[match.toLowerCase()] || match);
}

export function prepareTextForSynthesis(text) {
  let result = String(text || '');

  // Must run BEFORE the Greek-letter pass: "5µg" has to become "5 micrograms"
  // while µ is still attached to its unit (afterwards it would read "5 mu g").
  result = expandNumericNotation(result);

  result = result
    .replace(/\r\n/g, '\n')
    .replace(/[•●◦]/gu, '. ')
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[Δ∆]/g, 'delta ')
    // Greek letters common in medical text. GPT-SoVITS's English normalizer strips
    // any character outside A-Za-z'.,?!- so an unmapped Greek letter is DELETED
    // silently ("β-blocker" -> "blocker") — spell them out before synthesis.
    .replace(/[αΑ]/g, ' alpha ')
    .replace(/[βΒ]/g, ' beta ')
    .replace(/[γΓ]/g, ' gamma ')
    .replace(/[εΕ]/g, ' epsilon ')
    .replace(/[θΘ]/g, ' theta ')
    .replace(/[κ]/g, ' kappa ')
    .replace(/[λΛ]/g, ' lambda ')
    .replace(/[μµ]/g, ' mu ')
    .replace(/[πΠ]/g, ' pi ')
    .replace(/[ρ]/g, ' rho ')
    .replace(/[σΣ]/g, ' sigma ')
    .replace(/[τ]/g, ' tau ')
    .replace(/[φΦ]/g, ' phi ')
    .replace(/[χ]/g, ' chi ')
    .replace(/[ψΨ]/g, ' psi ')
    .replace(/[ωΩ]/g, ' omega ')
    .replace(/[×]/gu, ' times ')
    .replace(/[÷]/gu, ' divided by ')
    .replace(/[±]/gu, ' plus or minus ')
    .replace(/[≤]/gu, ' less than or equal to ')
    .replace(/[≥]/gu, ' greater than or equal to ')
    .replace(/(\d)\s*-\s*(\d)/gu, '$1 to $2')
    .replace(/(\w)-(\w)/g, '$1 $2')
    .replace(/\s*[-–—]{2,}\s*/gu, ', ')
    .replace(/\s+[-–—]\s+/g, ', ')
    .replace(/^\s*[-–—]\s+/gmu, '. ');

  result = result.replace(abbrPattern, (match) => {
    for (const [abbr, expansion] of Object.entries(ABBREVIATIONS)) {
      if (abbr.toLowerCase() === match.toLowerCase()) return expansion;
    }
    return match;
  });

  result = result.replace(/\b([A-Za-z]+)\s*\/\s*([A-Za-z]+)\b/gu, '$1 or $2');

  result = result.replace(symbolPattern, (match) => SYMBOL_MAP[match] || match);

  // Convert explicit sequences before the standalone-letter pass so A/I are read
  // as letters here, while ordinary uses such as "A patient" and "I agree" remain
  // untouched. Dotted initialisms have already been rendered as spaced capitals by
  // applyEmphasisAndSpelling on synthesis routes.
  result = result.replace(/\b([A-Z](?:\s+[A-Z])+?)\b/gu, (sequence) => (
    sequence.split(/\s+/u).map((letter) => INITIALISM_LETTER_NAMES[letter] || letter).join(' ')
  ));

  // Spell out standalone capital letters used as letters ("delta G", "type S").
  // Runs late so it can't disturb the abbreviation/symbol passes above. A and I
  // are real words and are excluded via LETTER_NAMES.
  result = result.replace(/\b([A-Z])\b/gu, (m, letter) => LETTER_NAMES[letter] || m);

  return splitCompoundWords(result).trim();
}

// Live Full accepts the extra preprocessing cost in exchange for deterministic
// scientific narration. Live Fast intentionally keeps using prepareTextForSynthesis
// directly, so formula handling cannot change its latency or established output.
export function prepareTextForFullSynthesis(text) {
  return prepareTextForSynthesis(expandChemicalFormulas(text));
}
