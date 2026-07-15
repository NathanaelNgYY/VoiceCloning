const CSV_COLUMNS = ['word', 'category', 'arpabet', 'verifyPhonemes', 'notes'];
const LEGACY_CSV_COLUMNS = ['word', 'category', 'readable', 'arpabet', 'notes'];
const LEGACY_STRICT_CSV_COLUMNS = ['word', 'category', 'readable', 'arpabet', 'verifyPhonemes', 'notes'];
const IMPORT_COLUMNS = new Set([...CSV_COLUMNS, 'readable']);

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

export function serializePronunciationCsv(entries = []) {
  const rows = [CSV_COLUMNS];
  for (const entry of entries) {
    rows.push(CSV_COLUMNS.map((column) => (
      column === 'verifyPhonemes' ? (entry.verifyPhonemes === true ? 'true' : 'false') : (entry[column] || '')
    )));
  }
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function parsePronunciationCsv(text, defaultCategory = 'general') {
  const rows = parseCsvRows(String(text || '').trim());
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const hasHeader = headers.includes('word');
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const columns = hasHeader ? headers : (dataRows.some((row) => row.length >= LEGACY_STRICT_CSV_COLUMNS.length)
    ? LEGACY_STRICT_CSV_COLUMNS
    : (/^(?:true|false|1|0|yes|no)$/iu.test(String(dataRows[0]?.[3] || '').trim())
      ? CSV_COLUMNS
      : LEGACY_CSV_COLUMNS));

  return dataRows
    .map((row) => {
      const entry = {};
      columns.forEach((column, index) => {
        if (IMPORT_COLUMNS.has(column)) entry[column] = String(row[index] || '').trim();
      });
      return {
        word: entry.word || '',
        category: entry.category || defaultCategory,
        arpabet: entry.arpabet || '',
        verifyPhonemes: /^(?:true|1|yes)$/iu.test(entry.verifyPhonemes || ''),
        notes: entry.notes || '',
      };
    })
    .filter((entry) => entry.word && entry.arpabet);
}

