import test from 'node:test';
import assert from 'node:assert/strict';

import { loadClipScores } from './clipScores.js';

function bufferJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf-8');
}

test('loadClipScores reads the dataset cache into a filename→score map', async () => {
  const readKeys = [];
  const scores = await loadClipScores('lecturer-a', {
    readObject: async (key) => {
      readKeys.push(key);
      return bufferJson({
        'a.wav': { score: 81.5, snr_db: 30 },
        'b.wav': { score: 42.0, snr_db: 12 },
      });
    },
  });

  assert.deepEqual(readKeys, ['training/datasets/lecturer-a/clip-scores.json']);
  assert.equal(scores.get('a.wav'), 81.5);
  assert.equal(scores.get('b.wav'), 42.0);
});

test('loadClipScores returns an empty map when the cache is missing or unreadable', async () => {
  const missing = await loadClipScores('lecturer-a', {
    readObject: async () => { throw new Error('NoSuchKey'); },
  });
  assert.equal(missing.size, 0);

  const garbage = await loadClipScores('lecturer-a', {
    readObject: async () => Buffer.from('not json', 'utf-8'),
  });
  assert.equal(garbage.size, 0);
});

test('loadClipScores skips entries with non-numeric scores', async () => {
  const scores = await loadClipScores('lecturer-a', {
    readObject: async () => bufferJson({
      'good.wav': { score: 70 },
      'bad.wav': { score: 'oops' },
      'none.wav': {},
    }),
  });
  assert.equal(scores.get('good.wav'), 70);
  assert.equal(scores.has('bad.wav'), false);
  assert.equal(scores.has('none.wav'), false);
});
