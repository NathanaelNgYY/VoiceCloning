import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PENDING_FULL_TTS_STORAGE_KEY,
  clearPendingFullTts,
  loadPendingFullTts,
  normalizePendingFullTts,
  savePendingFullTts,
} from './pendingFullTts.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('pending Full generation survives a refresh with the same session identity', () => {
  const storage = memoryStorage();
  const savedAt = 1_800_000;
  assert.equal(savePendingFullTts({
    sessionId: 'session-123',
    route: 'full',
    text: 'Keep generating this passage.',
    voiceName: 'DeanVoice',
    languageLabel: 'English',
    totalChunks: 4,
    completedChunks: 1,
    chunks: [{ index: 0, text: 'Keep generating this passage.' }],
    currentChunkText: 'Keep generating this passage.',
    savedAt,
  }, storage), true);

  assert.deepEqual(loadPendingFullTts(storage, { now: savedAt + 1_000 }), {
    sessionId: 'session-123',
    route: 'full',
    text: 'Keep generating this passage.',
    voiceName: 'DeanVoice',
    languageLabel: 'English',
    totalChunks: 4,
    completedChunks: 1,
    chunks: [{ index: 0, text: 'Keep generating this passage.' }],
    currentChunkText: 'Keep generating this passage.',
    savedAt,
  });
});

test('expired or malformed pending generations are discarded', () => {
  const storage = memoryStorage();
  storage.setItem(PENDING_FULL_TTS_STORAGE_KEY, JSON.stringify({
    sessionId: 'session-123',
    route: 'fast',
    text: 'Wrong route',
    savedAt: 100,
  }));
  assert.equal(loadPendingFullTts(storage, { now: 200 }), null);
  assert.equal(storage.getItem(PENDING_FULL_TTS_STORAGE_KEY), null);

  assert.equal(normalizePendingFullTts({
    sessionId: 'session-123',
    route: 'full',
    text: 'Expired',
    savedAt: 100,
  }, { now: 1_000, maxAgeMs: 100 }), null);
});

test('storage failures never break generation or cleanup', () => {
  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(savePendingFullTts({
    sessionId: 'session-123',
    route: 'fullQueued',
    text: 'Still safe.',
    savedAt: Date.now(),
  }, blocked), false);
  assert.equal(loadPendingFullTts(blocked), null);
  assert.doesNotThrow(() => clearPendingFullTts(blocked));
});
