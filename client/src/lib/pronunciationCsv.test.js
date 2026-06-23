import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePronunciationCsv,
  serializePronunciationCsv,
} from './pronunciationCsv.js';

test('serializePronunciationCsv exports reviewed dictionary entries', () => {
  const csv = serializePronunciationCsv([
    {
      word: 'enzyme',
      category: 'biology',
      readable: 'en zyme',
      arpabet: 'EH1 N Z AY0 M',
      notes: 'quoted, note',
    },
  ]);

  assert.match(csv, /^word,category,readable,arpabet,notes/u);
  assert.match(csv, /enzyme,biology,en zyme,EH1 N Z AY0 M,"quoted, note"/u);
});

test('parsePronunciationCsv imports header and headerless rows', () => {
  assert.deepEqual(parsePronunciationCsv('word,category,readable,arpabet\nATP,biology,,EY1 T IY1 P IY1\n'), [
    {
      word: 'ATP',
      category: 'biology',
      readable: '',
      arpabet: 'EY1 T IY1 P IY1',
      notes: '',
    },
  ]);

  assert.deepEqual(parsePronunciationCsv('enzyme,biology,en zyme,,', 'general'), [
    {
      word: 'enzyme',
      category: 'biology',
      readable: 'en zyme',
      arpabet: '',
      notes: '',
    },
  ]);
});
