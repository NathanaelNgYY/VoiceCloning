import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanOovWords, _resetOovCacheForTests } from './oovScan.js';

function makeRootWithDict(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oovscan-'));
  const textDir = path.join(root, 'GPT_SoVITS', 'text');
  fs.mkdirSync(textDir, { recursive: true });
  fs.writeFileSync(path.join(textDir, 'cmudict.rep'), lines.join('\n'), 'utf-8');
  return root;
}

test('flags a word missing from the dictionary and keeps a covered one', () => {
  _resetOovCacheForTests();
  const root = makeRootWithDict(['COHESIN  K OW0 HH IY1 S IH0 N', 'THE  DH AH0']);
  const result = scanOovWords('The cohesin binds separase tightly', { root });
  assert.ok(result.flagged.includes('separase'), 'separase should be flagged (OOV)');
  assert.ok(!result.flagged.includes('cohesin'), 'cohesin is in the dict → covered');
  assert.equal(result.dictionaryLoaded, true);
});

test('short words (<=3 chars) are treated as covered (letter read, not a guess)', () => {
  _resetOovCacheForTests();
  const root = makeRootWithDict(['THE  DH AH0']);
  const result = scanOovWords('an ox is by', { root });
  assert.deepEqual(result.flagged, [], 'all <=3-char words are covered');
});

test('a flagged word is reported once regardless of repeats/case', () => {
  _resetOovCacheForTests();
  const root = makeRootWithDict(['THE  DH AH0']);
  const result = scanOovWords('Separase separase SEPARASE', { root });
  assert.equal(result.flagged.length, 1);
});

test('empty dictionary reports dictionaryLoaded=false', () => {
  _resetOovCacheForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oovscan-empty-'));
  fs.mkdirSync(path.join(root, 'GPT_SoVITS', 'text'), { recursive: true });
  const result = scanOovWords('separase', { root });
  assert.equal(result.dictionaryLoaded, false);
});
