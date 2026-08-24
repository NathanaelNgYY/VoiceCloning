import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ensureCachedModel, modelCachePath } from './modelCache.js';

test('modelCachePath gives one stable path per model key and separates equal basenames', () => {
  const tempRoot = path.join('tmp', 'worker');
  const dean = modelCachePath('models/user-models/gpt/DeanVoice-e25.ckpt', { tempRoot });
  const sameBasename = modelCachePath('models/other/DeanVoice-e25.ckpt', { tempRoot });

  assert.match(path.basename(dean), /^DeanVoice-e25-[a-f0-9]{12}\.ckpt$/u);
  assert.equal(dean, modelCachePath('models/user-models/gpt/DeanVoice-e25.ckpt', { tempRoot }));
  assert.notEqual(dean, sameBasename);
});

test('ensureCachedModel reuses the canonical cached path without downloading again', async () => {
  const tempRoot = path.join('tmp', 'worker');
  const ref = 'models/user-models/sovits/DeanVoice_e20_s2260.pth';
  const cachedPath = modelCachePath(ref, { tempRoot });
  const existing = new Set();
  const downloads = [];
  const fsModule = {
    existsSync: value => existing.has(value),
    mkdirSync: () => {},
  };
  const download = async (source, destination) => {
    downloads.push({ source, destination });
    existing.add(destination);
  };

  assert.equal(await ensureCachedModel(ref, { tempRoot, fsModule, download }), cachedPath);
  assert.equal(await ensureCachedModel(ref, { tempRoot, fsModule, download }), cachedPath);
  assert.deepEqual(downloads, [{ source: ref, destination: cachedPath }]);
});
