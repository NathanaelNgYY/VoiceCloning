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
