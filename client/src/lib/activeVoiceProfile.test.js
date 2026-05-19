import test from 'node:test';
import assert from 'node:assert/strict';

import { formatActiveVoiceProfileSummary } from './activeVoiceProfile.js';

test('formatActiveVoiceProfileSummary shows display name with the saved voice profile id', () => {
  assert.equal(
    formatActiveVoiceProfileSummary({
      voiceProfileId: 'obama-v1',
      displayName: 'Obama',
    }),
    'Obama · obama-v1',
  );
});

test('formatActiveVoiceProfileSummary falls back to just the id when there is no display name', () => {
  assert.equal(
    formatActiveVoiceProfileSummary({
      voiceProfileId: 'custom-v2',
    }),
    'custom-v2',
  );
});

test('formatActiveVoiceProfileSummary returns the empty-state label when no saved profile exists', () => {
  assert.equal(formatActiveVoiceProfileSummary(null), 'No saved voice profile yet');
});
