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
  return splitCompoundWords(result).trim();
}
