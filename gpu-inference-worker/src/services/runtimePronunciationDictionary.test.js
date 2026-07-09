import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  applyReadableOverrides,
  buildHotDictionaryLines,
  writeHotDictionaryOverrides,
} from './runtimePronunciationDictionary.js';

test('applyReadableOverrides lets admin custom words override synthesis text immediately', () => {
  const text = applyReadableOverrides('Enzyme activity helps Foozyme work.', [
    { word: 'Foozyme', readable: 'foo zyme' },
    { word: 'enzyme', readable: 'en zyme' },
  ]);

  assert.equal(text, 'en zyme activity helps foo zyme work.');
});

test('applyReadableOverrides leaves ARPAbet entries as original words for dictionary lookup', () => {
  const text = applyReadableOverrides('Foozyme activity helps Barase work.', [
    { word: 'Foozyme', readable: 'foo zyme', arpabet: 'F UW1 Z AY0 M' },
    { word: 'Barase', readable: 'bar ace' },
  ]);

  assert.equal(text, 'Foozyme activity helps bar ace work.');
});

test('buildHotDictionaryLines converts admin ARPAbet entries into engdict-hot lines', () => {
  assert.deepEqual(buildHotDictionaryLines([
    { word: 'Foozyme', arpabet: 'F UW1 Z AY0 M' },
    { word: 'ReadableOnly', readable: 'readable only' },
  ]), ['FOOZYME F UW1 Z AY0 M']);
});

test('buildHotDictionaryLines rejects non-ASCII words instead of hijacking a surviving letter', () => {
  // "ΔG" would strip to the bare key "G" and register the delta pronunciation on
  // every standalone "G". The entry must be skipped, not mangled.
  assert.deepEqual(buildHotDictionaryLines([
    { word: 'ΔG', arpabet: 'D EH1 L T AH0 G IY1' },
    { word: 'β-blocker', arpabet: 'B EY1 T AH0 B L AA1 K ER0' },
    { word: 'Foozyme', arpabet: 'F UW1 Z AY0 M' },
  ]), ['FOOZYME F UW1 Z AY0 M']);
});

test('writeHotDictionaryOverrides appends managed admin block idempotently', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pronunciation-dict-'));
  const dictPath = path.join(root, 'GPT_SoVITS', 'text');
  fs.mkdirSync(dictPath, { recursive: true });
  const filePath = path.join(dictPath, 'engdict-hot.rep');
  fs.writeFileSync(filePath, 'EXISTING EH0 G Z IH1 S T IH0 NG\n', 'utf-8');

  writeHotDictionaryOverrides(root, [
    { word: 'Foozyme', arpabet: 'F UW1 Z AY0 M' },
  ]);
  writeHotDictionaryOverrides(root, [
    { word: 'Foozyme', arpabet: 'F UW1 Z AY0 M' },
  ]);

  const content = fs.readFileSync(filePath, 'utf-8');
  assert.equal((content.match(/FOOZYME/g) || []).length, 1);
  assert.match(content, /# BEGIN ADMIN PRONUNCIATION DICTIONARY/u);
});

test('writeHotDictionaryOverrides replaces existing matching hot dictionary words', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pronunciation-replace-'));
  const dictPath = path.join(root, 'GPT_SoVITS', 'text');
  fs.mkdirSync(dictPath, { recursive: true });
  const filePath = path.join(dictPath, 'engdict-hot.rep');
  fs.writeFileSync(filePath, 'FOOZYME OLD P R OW0 N\nOTHER AH1 DH ER0\n', 'utf-8');

  writeHotDictionaryOverrides(root, [
    { word: 'Foozyme', arpabet: 'F UW1 Z AY0 M' },
  ]);

  const content = fs.readFileSync(filePath, 'utf-8');
  assert.doesNotMatch(content, /FOOZYME OLD/u);
  assert.match(content, /OTHER AH1 DH ER0/u);
  assert.match(content, /FOOZYME F UW1 Z AY0 M/u);
});

test('writeHotDictionaryOverrides removes managed admin block when no ARPAbet entries remain', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pronunciation-clear-'));
  const dictPath = path.join(root, 'GPT_SoVITS', 'text');
  fs.mkdirSync(dictPath, { recursive: true });
  const filePath = path.join(dictPath, 'engdict-hot.rep');
  fs.writeFileSync(filePath, [
    'OTHER AH1 DH ER0',
    '# BEGIN ADMIN PRONUNCIATION DICTIONARY',
    'FOOZYME F UW1 Z AY0 M',
    '# END ADMIN PRONUNCIATION DICTIONARY',
    '',
  ].join('\n'), 'utf-8');

  writeHotDictionaryOverrides(root, []);

  const content = fs.readFileSync(filePath, 'utf-8');
  assert.match(content, /OTHER AH1 DH ER0/u);
  assert.doesNotMatch(content, /ADMIN PRONUNCIATION/u);
  assert.doesNotMatch(content, /FOOZYME/u);
});
