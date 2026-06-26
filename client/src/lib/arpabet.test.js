import test from 'node:test';
import assert from 'node:assert/strict';

import { arpabetToReadable, fetchDatamuseArpabet } from './arpabet.js';

test('arpabetToReadable renders chromosome with the stressed syllable uppercased', () => {
  assert.equal(arpabetToReadable('K R OW1 M AH0 S OW0 M'), 'KROH-muh-sohm');
});

test('arpabetToReadable renders enzyme', () => {
  assert.equal(arpabetToReadable('EH1 N Z AY0 M'), 'EH-nzym');
});

test('arpabetToReadable handles a single-syllable word', () => {
  assert.equal(arpabetToReadable('CH IY1 Z'), 'CHEEZ');
});

test('arpabetToReadable returns an empty string for empty input', () => {
  assert.equal(arpabetToReadable(''), '');
});

test('fetchDatamuseArpabet returns normalized arpabet on a hit', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => [{ word: 'chromosome', tags: ['pron:K R OW1 M AH0 S OW0 M'] }],
  });
  try {
    assert.deepEqual(await fetchDatamuseArpabet('chromosome'), { arpabet: 'K R OW1 M AH0 S OW0 M' });
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchDatamuseArpabet returns null when there are no results', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  try {
    assert.equal(await fetchDatamuseArpabet('zzzznotaword'), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchDatamuseArpabet returns null when the result lacks a pron tag', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [{ word: 'x', tags: ['n'] }] });
  try {
    assert.equal(await fetchDatamuseArpabet('x'), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchDatamuseArpabet throws on a non-OK response', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => [] });
  try {
    await assert.rejects(() => fetchDatamuseArpabet('chromosome'), /503/u);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchDatamuseArpabet returns null for an empty word without calling fetch', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => [] }; };
  try {
    assert.equal(await fetchDatamuseArpabet('   '), null);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});
