import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAutoVoiceProfileSyncFingerprint,
  getAutoSyncRequestFingerprint,
  shouldAutoSyncVoiceProfile,
} from './autoVoiceProfileSync.js';

test('createAutoVoiceProfileSyncFingerprint changes when auxiliary references change', () => {
  const base = createAutoVoiceProfileSyncFingerprint({
    sourceKey: 'obama',
    selectedGPT: 'models/user-models/gpt/obama.ckpt',
    selectedSoVITS: 'models/user-models/sovits/obama.pth',
    refAudioPath: 'training/datasets/obama/reference.wav',
    promptText: 'Reference transcript',
    promptLang: 'en',
    textLang: 'en',
    preferredRoute: 'sentence',
    auxRefAudioPaths: ['training/datasets/obama/aux1.wav'],
    defaults: {
      top_k: 5,
      top_p: 0.85,
      temperature: 0.7,
      repetition_penalty: 1.35,
      speed_factor: 1.0,
    },
  });

  const changedAux = createAutoVoiceProfileSyncFingerprint({
    sourceKey: 'obama',
    selectedGPT: 'models/user-models/gpt/obama.ckpt',
    selectedSoVITS: 'models/user-models/sovits/obama.pth',
    refAudioPath: 'training/datasets/obama/reference.wav',
    promptText: 'Reference transcript',
    promptLang: 'en',
    textLang: 'en',
    preferredRoute: 'sentence',
    auxRefAudioPaths: [
      'training/datasets/obama/aux1.wav',
      'training/datasets/obama/aux2.wav',
    ],
    defaults: {
      top_k: 5,
      top_p: 0.85,
      temperature: 0.7,
      repetition_penalty: 1.35,
      speed_factor: 1.0,
    },
  });

  assert.notEqual(base, changedAux);
});

test('shouldAutoSyncVoiceProfile only enables sync for the pending fingerprint when ready', () => {
  assert.equal(
    shouldAutoSyncVoiceProfile({
      pendingFingerprint: 'fingerprint-a',
      currentFingerprint: 'fingerprint-a',
      lastSyncedFingerprint: 'fingerprint-b',
      ready: true,
      busy: false,
    }),
    true,
  );

  assert.equal(
    shouldAutoSyncVoiceProfile({
      pendingFingerprint: 'fingerprint-c',
      currentFingerprint: 'fingerprint-a',
      lastSyncedFingerprint: 'fingerprint-b',
      ready: true,
      busy: false,
    }),
    false,
  );

  assert.equal(
    shouldAutoSyncVoiceProfile({
      pendingFingerprint: 'fingerprint-a',
      currentFingerprint: 'fingerprint-a',
      lastSyncedFingerprint: 'fingerprint-a',
      ready: true,
      busy: false,
    }),
    false,
  );

  assert.equal(
    shouldAutoSyncVoiceProfile({
      pendingFingerprint: 'fingerprint-a',
      currentFingerprint: 'fingerprint-a',
      lastSyncedFingerprint: 'fingerprint-b',
      ready: false,
      busy: false,
    }),
    false,
  );
});

test('getAutoSyncRequestFingerprint does not restart the same in-flight sync request', () => {
  assert.equal(
    getAutoSyncRequestFingerprint({
      pendingFingerprint: 'fingerprint-a',
      currentFingerprint: 'fingerprint-a',
      lastSyncedFingerprint: 'fingerprint-b',
      ready: true,
      busy: false,
      inFlightFingerprint: '',
    }),
    'fingerprint-a',
  );

  assert.equal(
    getAutoSyncRequestFingerprint({
      pendingFingerprint: 'fingerprint-a',
      currentFingerprint: 'fingerprint-a',
      lastSyncedFingerprint: 'fingerprint-b',
      ready: true,
      busy: false,
      inFlightFingerprint: 'fingerprint-a',
    }),
    '',
  );
});
