import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The email-to-voice mapping is duplicated because the client bundle, the
// Lambda router, and the GPU training worker are packaged separately with no
// shared module between them. All three must agree on the name a given email
// owns, or a lecturer trains under one name and the faculty app looks for
// another. A copy is only safe if drift is caught, so this asserts the three
// are byte-identical.
//
// If this fails: a fix landed in one copy and not the others. Copy the changed
// file over the others — do not "reconcile" them by hand.
const COPIES = {
  'client/src/lib/voiceIdentity.js': '../../client/src/lib/voiceIdentity.js',
  'gpu-worker/src/services/voiceIdentity.js': '../../gpu-worker/src/services/voiceIdentity.js',
};

test('every copy of the email-to-voice mapping is identical', () => {
  const canonical = readFileSync(new URL('./voiceIdentity.js', import.meta.url), 'utf8')
    .replace(/\r\n/gu, '\n');

  for (const [label, relativePath] of Object.entries(COPIES)) {
    const copy = readFileSync(new URL(relativePath, import.meta.url), 'utf8').replace(/\r\n/gu, '\n');
    assert.equal(copy, canonical, `${label} has drifted from lambda/shared/voiceIdentity.js`);
  }
});
