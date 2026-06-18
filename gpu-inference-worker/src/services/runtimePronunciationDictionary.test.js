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

test('buildHotDictionaryLines converts admin ARPAbet entries into engdict-hot lines', () => {
  assert.deepEqual(buildHotDictionaryLines([
    { word: 'Foozyme', arpabet: 'F UW1 Z AY0 M' },
    { word: 'ReadableOnly', readable: 'readable only' },
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
