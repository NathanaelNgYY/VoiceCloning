import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModelPair, persistSavedProfileReferenceSelection } from './modelSelection.js';
import { resolveSavedProfileReferenceSelection } from './modelSelection.js';

function bufferJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf-8');
}

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    process.env[key] = values[key];
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(values)) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
    });
}

test('reference persistence repairs a stale transcript even when reference paths are unchanged', async () => {
  const primaryPath = 'training/datasets/dean/denoised/primary.wav';
  const auxPaths = Array.from({ length: 5 }, (_, index) => (
    `training/datasets/dean/denoised/aux-${index + 1}.wav`
  ));
  const writes = [];
  const changed = await persistSavedProfileReferenceSelection({
    voiceProfileId: 'dean-v1',
    ref_audio_path: primaryPath,
    aux_ref_audio_paths: auxPaths,
    prompt_text: 'Transcript belonging to the previous primary.',
    prompt_lang: 'en',
  }, {
    ref_audio_path: primaryPath,
    aux_ref_audio_paths: auxPaths,
    prompt_text: 'Transcript belonging to this primary.',
    prompt_lang: 'en',
  }, {
    readObject: async () => null,
    writeObject: async (key, buffer) => writes.push({
      key,
      body: JSON.parse(buffer.toString('utf-8')),
    }),
  });

  assert.equal(changed, true);
  assert.equal(writes[0].body.prompt_text, 'Transcript belonging to this primary.');
});

test('loadModelPair prefers the saved voice profile references before training-audio auto selection', async () => {
  const calls = [];
  const readKeys = [];

  await withEnv({
    MODEL_SOURCE: 'gpu-worker',
  }, async () => {
    const response = await loadModelPair({
      voiceProfileId: 'lecturer-a-v1',
      gptKey: 'models/user-models/gpt/lecturer-a-e25.ckpt',
      sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
    }, {
      postInference: async (routePath, body = {}) => {
        calls.push({ routePath, body });
        if (routePath.startsWith('/inference/weights/')) {
          return {
            loaded: { gptPath: body.gptPath, sovitsPath: body.sovitsPath },
          };
        }
        return body;
      },
      readObject: async (key) => {
        readKeys.push(key);
        if (key === 'voice-profiles/lecturer-a-v1.json') {
          return bufferJson({
            voiceProfileId: 'lecturer-a-v1',
            displayName: 'Lecturer A',
            gptKey: 'models/user-models/gpt/lecturer-a-e25.ckpt',
            sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
            ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
            aux_ref_audio_paths: [
              'training/datasets/lecturer-a/aux-1.wav',
              'training/datasets/lecturer-a/aux-2.wav',
              'training/datasets/lecturer-a/aux-3.wav',
              'training/datasets/lecturer-a/aux-4.wav',
              'training/datasets/lecturer-a/aux-5.wav',
            ],
          });
        }
        return null;
      },
      listTrainingAudioFiles: async () => {
        throw new Error('training audio auto selection should not run when a saved profile exists');
      },
    });

    assert.deepEqual(readKeys, ['voice-profiles/lecturer-a-v1.json']);
    assert.deepEqual(calls, [
      {
        routePath: '/inference/weights/pair',
        body: {
          gptPath: 'models/user-models/gpt/lecturer-a-e25.ckpt',
          sovitsPath: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
        },
      },
      {
        routePath: '/ref-audio/warm',
        body: {
          ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
          aux_ref_audio_paths: [
            'training/datasets/lecturer-a/aux-1.wav',
            'training/datasets/lecturer-a/aux-2.wav',
            'training/datasets/lecturer-a/aux-3.wav',
            'training/datasets/lecturer-a/aux-4.wav',
            'training/datasets/lecturer-a/aux-5.wav',
          ],
        },
      },
    ]);
    assert.deepEqual(response.warmedReferences, {
      ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
      aux_ref_audio_paths: [
        'training/datasets/lecturer-a/aux-1.wav',
        'training/datasets/lecturer-a/aux-2.wav',
        'training/datasets/lecturer-a/aux-3.wav',
        'training/datasets/lecturer-a/aux-4.wav',
        'training/datasets/lecturer-a/aux-5.wav',
      ],
    });
  });
});

test('loadModelPair falls back to the active saved profile before training-audio auto selection when the model pair matches', async () => {
  const calls = [];
  const readKeys = [];

  await withEnv({
    MODEL_SOURCE: 'gpu-worker',
  }, async () => {
    const response = await loadModelPair({
      gptKey: 'models/user-models/gpt/obama.ckpt',
      sovitsKey: 'models/user-models/sovits/obama.pth',
    }, {
      postInference: async (routePath, body = {}) => {
        calls.push({ routePath, body });
        if (routePath.startsWith('/inference/weights/')) {
          return {
            loaded: { gptPath: body.weightsPath, sovitsPath: body.weightsPath },
          };
        }
        return body;
      },
      readObject: async (key) => {
        readKeys.push(key);
        if (key === 'voice-profiles/active.json') {
          return bufferJson({
            voiceProfileId: 'obama-v1',
            displayName: 'Obama',
            gptKey: 'models/user-models/gpt/obama.ckpt',
            sovitsKey: 'models/user-models/sovits/obama.pth',
            ref_audio_path: 'training/datasets/obama/reference.wav',
            aux_ref_audio_paths: [
              'training/datasets/obama/aux-1.wav',
              'training/datasets/obama/aux-2.wav',
              'training/datasets/obama/aux-3.wav',
              'training/datasets/obama/aux-4.wav',
              'training/datasets/obama/aux-5.wav',
            ],
          });
        }
        return null;
      },
      listTrainingAudioFiles: async () => {
        throw new Error('training audio auto selection should not run when the active saved profile matches');
      },
    });

    assert.deepEqual(readKeys, ['voice-profiles/active.json']);
    assert.deepEqual(calls.at(-1), {
      routePath: '/ref-audio/warm',
        body: {
          ref_audio_path: 'training/datasets/obama/reference.wav',
          aux_ref_audio_paths: [
            'training/datasets/obama/aux-1.wav',
            'training/datasets/obama/aux-2.wav',
            'training/datasets/obama/aux-3.wav',
            'training/datasets/obama/aux-4.wav',
            'training/datasets/obama/aux-5.wav',
          ],
        },
      });
    assert.deepEqual(response.warmedReferences, {
      ref_audio_path: 'training/datasets/obama/reference.wav',
      aux_ref_audio_paths: [
        'training/datasets/obama/aux-1.wav',
        'training/datasets/obama/aux-2.wav',
        'training/datasets/obama/aux-3.wav',
        'training/datasets/obama/aux-4.wav',
        'training/datasets/obama/aux-5.wav',
      ],
    });
  });
});

test('loadModelPair refreshes a complete stale profile when its default config is auto-managed', async () => {
  const listedExpNames = [];
  const writes = [];
  const calls = [];
  const oldAux = Array.from({ length: 5 }, (_, index) => `training/datasets/old/aux-${index + 1}.wav`);
  const newFiles = Array.from({ length: 6 }, (_, index) => ({
    filename: `lecturer-new_clip_${index * 160000}_${index * 160000 + 160000}.wav`,
    path: `training/datasets/lecturer-new/denoised/lecturer-new_clip_${index * 160000}_${index * 160000 + 160000}.wav`,
    transcript: `This is clean reference sentence number ${index + 1}.`,
    lang: 'en',
    qualityScore: 90 - index,
    qualityMetrics: { eligible: true },
  }));

  await withEnv({ MODEL_SOURCE: 'gpu-worker' }, async () => {
    const response = await loadModelPair({
      voiceProfileId: 'lecturer-new-v1',
      gptKey: 'models/user-models/gpt/lecturer-new-e25.ckpt',
      sovitsKey: 'models/user-models/sovits/lecturer-new-e25-s100.pth',
      refresh_auto_references: true,
    }, {
      postInference: async (routePath, body = {}) => {
        calls.push({ routePath, body });
        return routePath.startsWith('/inference/weights/')
          ? { loaded: { gptPath: body.gptPath, sovitsPath: body.sovitsPath } }
          : body;
      },
      listTrainingAudioFiles: async (expName) => {
        listedExpNames.push(expName);
        return newFiles;
      },
      readObject: async (key) => {
        if (key === 'voice-profiles/lecturer-new-v1.json' || key === 'voice-profiles/active.json') {
          return bufferJson({
            voiceProfileId: 'lecturer-new-v1',
            displayName: 'Lecturer New',
            gptKey: 'models/user-models/gpt/lecturer-new-e25.ckpt',
            sovitsKey: 'models/user-models/sovits/lecturer-new-e25-s100.pth',
            ref_audio_path: 'training/datasets/old/primary.wav',
            aux_ref_audio_paths: oldAux,
            ...(key.endsWith('/active.json') ? { activatedAt: '2026-08-20T00:00:00.000Z' } : {}),
          });
        }
        return null;
      },
      writeObject: async (key, buffer) => {
        writes.push({ key, body: JSON.parse(buffer.toString('utf-8')) });
      },
    });

    assert.deepEqual(listedExpNames, ['lecturer-new']);
    assert.equal(response.warmedReferences.ref_audio_path, newFiles[0].path);
    assert.equal(response.warmedReferences.aux_ref_audio_paths.length, 5);
    assert.equal(response.warmedReferences.prompt_text, newFiles[0].transcript);
    assert.equal(response.warmedReferences.prompt_lang, newFiles[0].lang);
    assert.equal(writes.length, 3);
    assert.equal(writes[0].key, 'voice-profiles/lecturer-new-v1.json');
    assert.equal(writes[0].body.ref_audio_path, newFiles[0].path);
    assert.equal(writes[0].body.prompt_text, newFiles[0].transcript);
    assert.equal(writes[0].body.prompt_lang, newFiles[0].lang);
    assert.equal(writes[2].key, 'voice-profile-configs/lecturer-new-v1/default.json');
    assert.equal(writes[2].body.referenceMetadata.mode, 'auto');
    assert.equal(writes[2].body.referenceMetadata.primary.transcript, newFiles[0].transcript);
    assert.equal(writes[2].body.referenceMetadata.primary.lang, newFiles[0].lang);
    assert.deepEqual(calls.at(-1), {
      routePath: '/ref-audio/warm',
      body: response.warmedReferences,
    });
  });
});

test('auto refresh never persists another model pair references into the requested profile', async () => {
  const writes = [];
  const files = Array.from({ length: 6 }, (_, index) => ({
    filename: `lecturer-new_clip_${index * 160000}_${index * 160000 + 160000}.wav`,
    path: `training/datasets/lecturer-new/denoised/lecturer-new_clip_${index * 160000}_${index * 160000 + 160000}.wav`,
    transcript: `This is clean reference sentence number ${index + 1}.`,
    lang: 'en',
    qualityScore: 90 - index,
    qualityMetrics: { eligible: true },
  }));

  await withEnv({ MODEL_SOURCE: 'gpu-worker' }, async () => {
    const response = await loadModelPair({
      voiceProfileId: 'wrong-profile-v1',
      gptKey: 'models/user-models/gpt/lecturer-new-e25.ckpt',
      sovitsKey: 'models/user-models/sovits/lecturer-new-e25-s100.pth',
      refresh_auto_references: true,
    }, {
      postInference: async (routePath, body = {}) => (
        routePath.startsWith('/inference/weights/')
          ? { loaded: { gptPath: body.gptPath, sovitsPath: body.sovitsPath } }
          : body
      ),
      listTrainingAudioFiles: async () => files,
      readObject: async (key) => (
        key === 'voice-profiles/wrong-profile-v1.json'
          ? bufferJson({
            voiceProfileId: 'wrong-profile-v1',
            gptKey: 'models/user-models/gpt/someone-else-e25.ckpt',
            sovitsKey: 'models/user-models/sovits/someone-else-e25-s100.pth',
            ref_audio_path: 'training/datasets/someone-else/primary.wav',
            aux_ref_audio_paths: [],
          })
          : null
      ),
      writeObject: async (key, buffer) => {
        writes.push({ key, body: JSON.parse(buffer.toString('utf-8')) });
      },
    });

    assert.equal(response.warmedReferences.ref_audio_path, files[0].path);
    assert.deepEqual(writes, []);
  });
});

test('loadModelPair auto-selects primary and aux when the saved profile has fewer than five auxiliary references', async () => {
  const calls = [];
  const readKeys = [];
  const listedExpNames = [];
  const writes = [];

  await withEnv({
    MODEL_SOURCE: 'gpu-worker',
  }, async () => {
    const response = await loadModelPair({
      voiceProfileId: 'lecturer-a-v1',
      gptKey: 'models/user-models/gpt/lecturer-a-e25.ckpt',
      sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
    }, {
      postInference: async (routePath, body = {}) => {
        calls.push({ routePath, body });
        if (routePath.startsWith('/inference/weights/')) {
          return {
            loaded: { gptPath: body.weightsPath, sovitsPath: body.weightsPath },
          };
        }
        return body;
      },
      readObject: async (key) => {
        readKeys.push(key);
        if (key === 'voice-profiles/lecturer-a-v1.json') {
          return bufferJson({
            voiceProfileId: 'lecturer-a-v1',
            displayName: 'Lecturer A',
            gptKey: 'models/user-models/gpt/lecturer-a-e25.ckpt',
            sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
            ref_audio_path: 'training/datasets/lecturer-a/manual-primary.wav',
            aux_ref_audio_paths: ['training/datasets/lecturer-a/manual-aux-1.wav'],
          });
        }
        if (key === 'voice-profiles/active.json') {
          return bufferJson({
            voiceProfileId: 'lecturer-a-v1',
            displayName: 'Lecturer A',
            gptKey: 'models/user-models/gpt/lecturer-a-e25.ckpt',
            sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
            ref_audio_path: 'training/datasets/lecturer-a/manual-primary.wav',
            aux_ref_audio_paths: ['training/datasets/lecturer-a/manual-aux-1.wav'],
            activatedAt: '2026-06-03T08:00:00.000Z',
          });
        }
        return null;
      },
      writeObject: async (key, buffer) => {
        writes.push({ key, body: JSON.parse(buffer.toString('utf-8')) });
      },
      listTrainingAudioFiles: async (expName) => {
        listedExpNames.push(expName);
        return [
          {
            filename: 'lecturer-a_reference_0_192000.wav',
            path: 'training/datasets/lecturer-a/lecturer-a_reference_0_192000.wav',
            transcript: 'This is the balanced reference clip for the lecturer voice.',
            lang: 'en',
            qualityScore: 80,
          },
          {
            filename: 'lecturer-a_support_0_160000.wav',
            path: 'training/datasets/lecturer-a/lecturer-a_support_0_160000.wav',
            transcript: 'This support clip keeps the voice steady for synthesis.',
            lang: 'en',
            qualityScore: 60,
          },
        ];
      },
    });

    assert.deepEqual(readKeys, ['voice-profiles/lecturer-a-v1.json', 'voice-profiles/active.json']);
    assert.deepEqual(listedExpNames, ['lecturer-a']);
    assert.equal(writes.length, 3);
    assert.deepEqual(writes[0], {
      key: 'voice-profiles/lecturer-a-v1.json',
      body: {
        voiceProfileId: 'lecturer-a-v1',
        displayName: 'Lecturer A',
        gptKey: 'models/user-models/gpt/lecturer-a-e25.ckpt',
        sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
        ref_audio_path: 'training/datasets/lecturer-a/lecturer-a_reference_0_192000.wav',
        aux_ref_audio_paths: ['training/datasets/lecturer-a/lecturer-a_support_0_160000.wav'],
        prompt_text: 'This is the balanced reference clip for the lecturer voice.',
        prompt_lang: 'en',
        updatedAt: writes[0].body.updatedAt,
      },
    });
    assert.deepEqual(writes[1], {
      key: 'voice-profiles/active.json',
      body: {
        voiceProfileId: 'lecturer-a-v1',
        displayName: 'Lecturer A',
        gptKey: 'models/user-models/gpt/lecturer-a-e25.ckpt',
        sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
        ref_audio_path: 'training/datasets/lecturer-a/lecturer-a_reference_0_192000.wav',
        aux_ref_audio_paths: ['training/datasets/lecturer-a/lecturer-a_support_0_160000.wav'],
        activatedAt: '2026-06-03T08:00:00.000Z',
        prompt_text: 'This is the balanced reference clip for the lecturer voice.',
        prompt_lang: 'en',
        updatedAt: writes[1].body.updatedAt,
      },
    });
    assert.equal(writes[2].key, 'voice-profile-configs/lecturer-a-v1/default.json');
    assert.equal(writes[2].body.configId, 'default');
    assert.equal(writes[2].body.rank, 1);
    assert.equal(writes[2].body.referenceMetadata.selectedPaths.primary, 'training/datasets/lecturer-a/lecturer-a_reference_0_192000.wav');
    assert.deepEqual(writes[2].body.referenceMetadata.selectedPaths.aux, ['training/datasets/lecturer-a/lecturer-a_support_0_160000.wav']);
    assert.deepEqual(calls.at(-1), {
      routePath: '/ref-audio/warm',
      body: {
        ref_audio_path: 'training/datasets/lecturer-a/lecturer-a_reference_0_192000.wav',
        aux_ref_audio_paths: ['training/datasets/lecturer-a/lecturer-a_support_0_160000.wav'],
        prompt_text: 'This is the balanced reference clip for the lecturer voice.',
        prompt_lang: 'en',
      },
    });
    assert.deepEqual(response.warmedReferences, {
      ref_audio_path: 'training/datasets/lecturer-a/lecturer-a_reference_0_192000.wav',
      aux_ref_audio_paths: ['training/datasets/lecturer-a/lecturer-a_support_0_160000.wav'],
      prompt_text: 'This is the balanced reference clip for the lecturer voice.',
      prompt_lang: 'en',
    });
  });
});

test('resolveSavedProfileReferenceSelection ranks training audio by audio quality score', async () => {
  const selection = await resolveSavedProfileReferenceSelection(
    { sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth' },
    {
      listTrainingAudioFiles: async () => ([
        { filename: 'a_0_160000.wav', path: 'training/datasets/lecturer-a/denoised/a_0_160000.wav', transcript: 'Clear reference sentence one for testing.', lang: 'en', qualityScore: 40 },
        { filename: 'b_0_192000.wav', path: 'training/datasets/lecturer-a/denoised/b_0_192000.wav', transcript: 'Clear reference sentence two for testing.', lang: 'en', qualityScore: 90 },
        { filename: 'c_0_224000.wav', path: 'training/datasets/lecturer-a/denoised/c_0_224000.wav', transcript: 'Clear reference sentence three for testing.', lang: 'en', qualityScore: 65 },
      ]),
    },
  );

  assert.equal(selection.ref_audio_path, 'training/datasets/lecturer-a/denoised/b_0_192000.wav');
  assert.deepEqual(selection.aux_ref_audio_paths, [
    'training/datasets/lecturer-a/denoised/c_0_224000.wav',
    'training/datasets/lecturer-a/denoised/a_0_160000.wav',
  ]);
});

test('resolveSavedProfileReferenceSelection transcript guard avoids an empty-transcript primary', async () => {
  const selection = await resolveSavedProfileReferenceSelection(
    { sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth' },
    {
      listTrainingAudioFiles: async () => ([
        { filename: 'pristine_0_192000.wav', path: 'training/datasets/lecturer-a/denoised/pristine_0_192000.wav', transcript: '', lang: 'en', qualityScore: 85 },
        { filename: 'usable_0_160000.wav', path: 'training/datasets/lecturer-a/denoised/usable_0_160000.wav', transcript: 'This is a perfectly usable reference sentence for cloning.', lang: 'en', qualityScore: 75 },
      ]),
    },
  );

  assert.equal(selection.ref_audio_path, 'training/datasets/lecturer-a/denoised/usable_0_160000.wav');
});

test('resolveSavedProfileReferenceSelection excludes measured acoustic failures', async () => {
  const selection = await resolveSavedProfileReferenceSelection({
    sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
  }, {
    listTrainingAudioFiles: async () => [
      { filename: 'clipped_0_160000.wav', path: 'd/clipped_0_160000.wav', transcript: 'This apparently strong sentence is badly clipped.', lang: 'en', qualityScore: 99, qualityMetrics: { score: 99, eligible: false } },
      { filename: 'clean_160000_320000.wav', path: 'd/clean_160000_320000.wav', transcript: 'This clean sentence should become the reference.', lang: 'en', qualityScore: 75, qualityMetrics: { score: 75, eligible: true } },
    ],
  });

  assert.equal(selection.ref_audio_path, 'd/clean_160000_320000.wav');
});

test('loadModelPair returns canonical training paths even when ref warm resolves local cache paths', async () => {
  const calls = [];

  await withEnv({
    MODEL_SOURCE: 'gpu-worker',
  }, async () => {
    const response = await loadModelPair({
      gptKey: 'models/user-models/gpt/lecturer-a-e25.ckpt',
      sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
      ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
      aux_ref_audio_paths: [
        'training/datasets/lecturer-a/aux-1.wav',
        'training/datasets/lecturer-a/aux-2.wav',
        'training/datasets/lecturer-a/aux-3.wav',
        'training/datasets/lecturer-a/aux-4.wav',
        'training/datasets/lecturer-a/aux-5.wav',
      ],
    }, {
      postInference: async (routePath, body = {}) => {
        calls.push({ routePath, body });
        if (routePath.startsWith('/inference/weights/')) {
          return {
            loaded: { gptPath: body.weightsPath, sovitsPath: body.weightsPath },
          };
        }
        if (routePath === '/ref-audio/warm') {
          return {
            ref_audio_path: '/tmp/ref_audio_cache/a1b2_reference.wav',
            aux_ref_audio_paths: [
              '/tmp/ref_audio_cache/a1b2_aux-1.wav',
              '/tmp/ref_audio_cache/a1b2_aux-2.wav',
              '/tmp/ref_audio_cache/a1b2_aux-3.wav',
              '/tmp/ref_audio_cache/a1b2_aux-4.wav',
              '/tmp/ref_audio_cache/a1b2_aux-5.wav',
            ],
          };
        }
        return body;
      },
    });

    assert.deepEqual(calls.at(-1), {
      routePath: '/ref-audio/warm',
      body: {
        ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
        aux_ref_audio_paths: [
          'training/datasets/lecturer-a/aux-1.wav',
          'training/datasets/lecturer-a/aux-2.wav',
          'training/datasets/lecturer-a/aux-3.wav',
          'training/datasets/lecturer-a/aux-4.wav',
          'training/datasets/lecturer-a/aux-5.wav',
        ],
      },
    });
    assert.deepEqual(response.warmedReferences, {
      ref_audio_path: 'training/datasets/lecturer-a/reference.wav',
      aux_ref_audio_paths: [
        'training/datasets/lecturer-a/aux-1.wav',
        'training/datasets/lecturer-a/aux-2.wav',
        'training/datasets/lecturer-a/aux-3.wav',
        'training/datasets/lecturer-a/aux-4.wav',
        'training/datasets/lecturer-a/aux-5.wav',
      ],
    });
  });
});
