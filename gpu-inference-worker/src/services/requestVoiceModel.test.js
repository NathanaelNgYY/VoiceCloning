import assert from 'node:assert/strict';
import test from 'node:test';
import { modelResidencyKey, voiceModelKey } from './requestVoiceModel.js';

test('residency identity groups profiles that use the same exact weight pair', () => {
  const dean = {
    voice_model: { voiceProfileId: 'dean-v1', gptRef: 'models/dean.ckpt', sovitsRef: 'models/dean.pth', revision: '1' },
  };
  const lectureCopy = {
    voice_model: { voiceProfileId: 'lecture-copy', gptRef: 'models/dean.ckpt', sovitsRef: 'models/dean.pth', revision: '9' },
  };
  assert.equal(modelResidencyKey(dean), modelResidencyKey(lectureCopy));
  assert.notEqual(voiceModelKey(dean), voiceModelKey(lectureCopy));
});

test('residency identity changes when either weight changes', () => {
  const base = { voice_model: { gptRef: 'g1.ckpt', sovitsRef: 's1.pth' } };
  assert.notEqual(
    modelResidencyKey(base),
    modelResidencyKey({ voice_model: { gptRef: 'g2.ckpt', sovitsRef: 's1.pth' } }),
  );
  assert.notEqual(
    modelResidencyKey(base),
    modelResidencyKey({ voice_model: { gptRef: 'g1.ckpt', sovitsRef: 's2.pth' } }),
  );
});
