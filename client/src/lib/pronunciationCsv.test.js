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
      synthesisAlias: 'en zyme',
      verifyPhonemes: true,
      notes: 'quoted, note',
    },
  ]);

  assert.match(csv, /^word,category,arpabet,synthesisAlias,verifyPhonemes,notes/u);
  assert.match(csv, /enzyme,biology,EH1 N Z AY0 M,en zyme,true,"quoted, note"/u);
});

test('parsePronunciationCsv imports header and headerless rows', () => {
  assert.deepEqual(parsePronunciationCsv('word,category,readable,arpabet\nATP,biology,,EY1 T IY1 P IY1\n'), [
    {
      word: 'ATP',
      category: 'biology',
      arpabet: 'EY1 T IY1 P IY1',
      synthesisAlias: '',
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
      synthesisAlias: '',
      verifyPhonemes: false,
      notes: 'legacy note',
    },
  ]);
});

test('parsePronunciationCsv imports synthesis aliases', () => {
  assert.deepEqual(parsePronunciationCsv(
    'word,category,arpabet,synthesisAlias,verifyPhonemes,notes\n'
      + 'stereochemistry,chemistry,S T EH2 R IY0 OW0 K EH1 M IH0 S T R IY0,stereo chemistry,true,reviewed\n',
  ), [{
    word: 'stereochemistry',
    category: 'chemistry',
    arpabet: 'S T EH2 R IY0 OW0 K EH1 M IH0 S T R IY0',
    synthesisAlias: 'stereo chemistry',
    verifyPhonemes: true,
    notes: 'reviewed',
  }]);
});
