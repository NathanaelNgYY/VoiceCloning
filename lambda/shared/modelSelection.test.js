import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModelPair } from './modelSelection.js';

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
        routePath: '/inference/weights/sovits',
        body: { weightsPath: 'models/user-models/sovits/lecturer-a-e25-s100.pth' },
      },
      {
        routePath: '/inference/weights/gpt',
        body: { weightsPath: 'models/user-models/gpt/lecturer-a-e25.ckpt' },
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
            filename: 'lecturer-a_reference.wav',
            path: 'training/datasets/lecturer-a/lecturer-a_reference.wav',
            transcript: 'This is the balanced reference clip for the lecturer voice.',
            lang: 'en',
          },
          {
            filename: 'lecturer-a_support.wav',
            path: 'training/datasets/lecturer-a/lecturer-a_support.wav',
            transcript: 'This support clip keeps the voice steady for synthesis.',
            lang: 'en',
          },
        ];
      },
    });

    assert.deepEqual(readKeys, ['voice-profiles/lecturer-a-v1.json', 'voice-profiles/active.json']);
    assert.deepEqual(listedExpNames, ['lecturer-a']);
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0], {
      key: 'voice-profiles/lecturer-a-v1.json',
      body: {
        voiceProfileId: 'lecturer-a-v1',
        displayName: 'Lecturer A',
        gptKey: 'models/user-models/gpt/lecturer-a-e25.ckpt',
        sovitsKey: 'models/user-models/sovits/lecturer-a-e25-s100.pth',
        ref_audio_path: 'training/datasets/lecturer-a/lecturer-a_reference.wav',
        aux_ref_audio_paths: ['training/datasets/lecturer-a/lecturer-a_support.wav'],
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
        ref_audio_path: 'training/datasets/lecturer-a/lecturer-a_reference.wav',
        aux_ref_audio_paths: ['training/datasets/lecturer-a/lecturer-a_support.wav'],
        activatedAt: '2026-06-03T08:00:00.000Z',
        updatedAt: writes[1].body.updatedAt,
      },
    });
    assert.deepEqual(calls.at(-1), {
      routePath: '/ref-audio/warm',
      body: {
        ref_audio_path: 'training/datasets/lecturer-a/lecturer-a_reference.wav',
        aux_ref_audio_paths: ['training/datasets/lecturer-a/lecturer-a_support.wav'],
      },
    });
    assert.deepEqual(response.warmedReferences, {
      ref_audio_path: 'training/datasets/lecturer-a/lecturer-a_reference.wav',
      aux_ref_audio_paths: ['training/datasets/lecturer-a/lecturer-a_support.wav'],
    });
  });
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
