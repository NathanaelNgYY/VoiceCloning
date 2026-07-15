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
      arpabet: 'EH1 N Z AY0 M',
      verifyPhonemes: true,
      notes: 'quoted, note',
    },
  ]);

  assert.match(csv, /^word,category,arpabet,verifyPhonemes,notes/u);
  assert.match(csv, /enzyme,biology,EH1 N Z AY0 M,true,"quoted, note"/u);
});

test('parsePronunciationCsv imports header and headerless rows', () => {
  assert.deepEqual(parsePronunciationCsv('word,category,readable,arpabet\nATP,biology,,EY1 T IY1 P IY1\n'), [
    {
      word: 'ATP',
      category: 'biology',
      arpabet: 'EY1 T IY1 P IY1',
      verifyPhonemes: false,
      notes: '',
    },
  ]);

  assert.deepEqual(parsePronunciationCsv('enzyme,biology,en zyme,,', 'general'), []);

  assert.deepEqual(parsePronunciationCsv('enzyme,biology,en zyme,EH1 N Z AY0 M,legacy note', 'general'), [
    {
      word: 'enzyme',
      category: 'biology',
      arpabet: 'EH1 N Z AY0 M',
      verifyPhonemes: false,
      notes: 'legacy note',
    },
  ]);
});
