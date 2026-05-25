import test from 'node:test';
import assert from 'node:assert/strict';

async function loadRefAudioCacheModule() {
  try {
    return await import('./refAudioCache.js');
  } catch (error) {
    assert.fail(`Expected refAudioCache service module to load: ${error.message}`);
  }
}

test('warmReferenceAudioPaths downloads missing remote refs once and reuses the cache', async () => {
  const module = await loadRefAudioCacheModule();
  assert.equal(typeof module.warmReferenceAudioPaths, 'function');

  const existingPaths = new Set(['/already/local.wav']);
  const downloadCalls = [];
  const mkdirCalls = [];

  const deps = {
    cacheRoot: '/cache/ref_audio',
    existsSync: (targetPath) => existingPaths.has(targetPath),
    mkdirSync: (targetPath, options) => {
      mkdirCalls.push({ targetPath, options });
      existingPaths.add(targetPath);
    },
    downloadFile: async (s3Key, localPath) => {
      downloadCalls.push({ s3Key, localPath });
      existingPaths.add(localPath);
    },
  };

  const params = {
    ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
    aux_ref_audio_paths: [
      'training/datasets/lecturer-a/aux1.wav',
      '/already/local.wav',
    ],
  };

  const firstWarm = await module.warmReferenceAudioPaths(params, deps);
  const secondWarm = await module.warmReferenceAudioPaths(params, deps);

  assert.match(firstWarm.ref_audio_path, /cache[\\/]ref_audio[\\/]/u);
  assert.match(firstWarm.aux_ref_audio_paths[0], /cache[\\/]ref_audio[\\/]/u);
  assert.equal(firstWarm.aux_ref_audio_paths[1], '/already/local.wav');
  assert.deepEqual(secondWarm, firstWarm);
  assert.equal(downloadCalls.length, 2);
  assert.equal(mkdirCalls.length >= 1, true);
});
