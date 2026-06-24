import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadCmuWordSet, isRealWord, _resetCmuCacheForTests } from './cmuDictionary.js';

function writeDict(contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmu-'));
  const dir = path.join(root, 'GPT_SoVITS', 'text');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cmudict.rep'), contents);
  return root;
}

test('loadCmuWordSet parses leading words and strips variant markers', () => {
  const root = writeDict('REALLY R IH1 L IY0\nREALLY(1) R IY1 L IY0\nSTOP S T AA1 P\n');
  const set = loadCmuWordSet(root);
  assert.ok(set.has('REALLY'));
  assert.ok(set.has('STOP'));
  assert.equal(set.has('ECG'), false);
});

test('loadCmuWordSet returns an empty set when the dictionary is missing', () => {
  const set = loadCmuWordSet(path.join(os.tmpdir(), 'cmu-does-not-exist-xyz'));
  assert.equal(set.size, 0);
});

test('loadCmuWordSet returns an empty set when no root is given', () => {
  assert.equal(loadCmuWordSet('').size, 0);
  assert.equal(loadCmuWordSet(null).size, 0);
});

test('isRealWord degrades to false when the dictionary cannot be found', () => {
  _resetCmuCacheForTests();
  assert.equal(isRealWord('REALLY', { root: path.join(os.tmpdir(), 'cmu-nope-xyz') }), false);
  _resetCmuCacheForTests();
});

test('isRealWord returns true for a word present in the dictionary', () => {
  _resetCmuCacheForTests();
  const root = writeDict('REALLY R IH1 L IY0\nSTOP S T AA1 P\n');
  assert.equal(isRealWord('really', { root }), true);
  assert.equal(isRealWord('ECG', { root }), false);
  _resetCmuCacheForTests();
});
