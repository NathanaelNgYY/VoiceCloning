import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPlayableAudioSource, withAudioCacheBuster } from './audioReadiness.js';

test('withAudioCacheBuster replaces the readiness key without damaging query parameters', () => {
  const result = withAudioCacheBuster('/audio.wav?token=abc', {
    now: 123,
    baseUrl: 'https://example.test/live',
  });
  assert.equal(result, 'https://example.test/audio.wav?token=abc&_audioReady=123');
});

test('playable audio retries incomplete responses then returns a verified blob URL', async () => {
  let calls = 0;
  const revoked = [];
  const result = await waitForPlayableAudioSource('/audio.wav', {
    attempts: 3,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? { ok: false, status: 404, blob: async () => new Blob() }
        : { ok: true, status: 200, blob: async () => new Blob([new Uint8Array(100)]) };
    },
    createObjectURL: () => 'blob:ready-audio',
    revokeObjectURL: (url) => revoked.push(url),
    waitForMetadata: async (url) => {
      if (!url.startsWith('blob:')) throw new Error('not ready');
    },
    sleep: async () => {},
    now: () => calls,
  });
  assert.equal(result, 'blob:ready-audio');
  assert.equal(calls, 2);
  assert.deepEqual(revoked, []);
});

test('failed blob metadata is revoked before retrying', async () => {
  let metadataCalls = 0;
  const revoked = [];
  const result = await waitForPlayableAudioSource('/audio.wav', {
    attempts: 2,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob([new Uint8Array(100)]),
    }),
    createObjectURL: () => `blob:attempt-${metadataCalls + 1}`,
    revokeObjectURL: (url) => revoked.push(url),
    waitForMetadata: async (url) => {
      metadataCalls += 1;
      if (metadataCalls === 1) throw new Error('metadata race');
      assert.match(url, /^blob:/);
    },
    sleep: async () => {},
  });
  assert.equal(result, 'blob:attempt-2');
  assert.deepEqual(revoked, ['blob:attempt-1']);
});
