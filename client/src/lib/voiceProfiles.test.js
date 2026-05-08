import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVoiceProfiles } from './voiceProfiles.js';

test('buildVoiceProfiles puts the most recently modified complete voice first', () => {
  const profiles = buildVoiceProfiles(
    [
      {
        name: 'aOlderVoice-e10.ckpt',
        path: '/models/gpt/aOlderVoice-e10.ckpt',
        lastModified: '2026-05-01T08:00:00.000Z',
      },
      {
        name: 'zNewVoice-e4.ckpt',
        path: '/models/gpt/zNewVoice-e4.ckpt',
        lastModified: '2026-05-07T08:00:00.000Z',
      },
    ],
    [
      {
        name: 'aOlderVoice-e10-s100.pth',
        path: '/models/sovits/aOlderVoice-e10-s100.pth',
        lastModified: '2026-05-01T08:05:00.000Z',
      },
      {
        name: 'zNewVoice-e4-s60.pth',
        path: '/models/sovits/zNewVoice-e4-s60.pth',
        lastModified: '2026-05-07T08:05:00.000Z',
      },
    ]
  );

  assert.equal(profiles[0].displayName, 'zNewVoice');
  assert.equal(profiles[0].recentAt, Date.parse('2026-05-07T08:05:00.000Z'));
  assert.equal(profiles[1].displayName, 'aOlderVoice');
});

test('buildVoiceProfiles keeps complete profiles ahead of incomplete recent models', () => {
  const profiles = buildVoiceProfiles(
    [
      {
        name: 'completeVoice-e3.ckpt',
        path: '/models/gpt/completeVoice-e3.ckpt',
        lastModified: '2026-05-05T08:00:00.000Z',
      },
      {
        name: 'gptOnly-e99.ckpt',
        path: '/models/gpt/gptOnly-e99.ckpt',
        lastModified: '2026-05-08T08:00:00.000Z',
      },
    ],
    [
      {
        name: 'completeVoice-e3-s20.pth',
        path: '/models/sovits/completeVoice-e3-s20.pth',
        lastModified: '2026-05-05T08:05:00.000Z',
      },
    ]
  );

  assert.equal(profiles[0].displayName, 'completeVoice');
  assert.equal(profiles[0].complete, true);
  assert.equal(profiles[1].displayName, 'gptOnly');
  assert.equal(profiles[1].complete, false);
});
