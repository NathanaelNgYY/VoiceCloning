import test from 'node:test';
import assert from 'node:assert/strict';

import { createVoiceProfileBrowserDebugSummary } from './voiceProfileDebug.js';

test('createVoiceProfileBrowserDebugSummary exposes the primary and all auxiliary clip paths', () => {
  const summary = createVoiceProfileBrowserDebugSummary({
    context: 'activate request',
    voiceProfileId: 'obama-v1',
    displayName: 'Obama',
    selectedExpName: 'Obama',
    refAudioPath: 'training/datasets/Obama/ref.wav',
    promptText: 'Good evening, America.',
    promptLang: 'en',
    textLang: 'en',
    auxRefAudioPaths: [
      'training/datasets/Obama/aux1.wav',
      'training/datasets/Obama/aux2.wav',
      'training/datasets/Obama/aux3.wav',
      'training/datasets/Obama/aux4.wav',
      'training/datasets/Obama/aux5.wav',
    ],
    defaults: {
      top_k: 5,
      top_p: 0.85,
      temperature: 0.7,
      repetition_penalty: 1.35,
      speed_factor: 1,
    },
  });

  assert.equal(summary.primary.path, 'training/datasets/Obama/ref.wav');
  assert.equal(summary.primary.filename, 'ref.wav');
  assert.equal(summary.auxCount, 5);
  assert.deepEqual(summary.aux.map((entry) => entry.filename), [
    'aux1.wav',
    'aux2.wav',
    'aux3.wav',
    'aux4.wav',
    'aux5.wav',
  ]);
});
