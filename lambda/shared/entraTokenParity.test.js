import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The token verifier is duplicated because the lambda and the live gateway are
// packaged and deployed separately, with no shared module between them. A copy is
// only safe if drift is caught, so this asserts the two are byte-identical.
//
// If this fails: a fix landed in one copy and not the other. Copy the changed
// file over the other one — do not "reconcile" them by hand.
test('the lambda and gateway token verifiers are identical', () => {
  const lambdaCopy = readFileSync(new URL('./entraToken.js', import.meta.url), 'utf8');
  const gatewayCopy = readFileSync(
    new URL('../../live-gateway/src/services/entraToken.js', import.meta.url),
    'utf8',
  );

  assert.equal(
    lambdaCopy.replace(/\r\n/gu, '\n'),
    gatewayCopy.replace(/\r\n/gu, '\n'),
    'lambda/shared/entraToken.js has drifted from live-gateway/src/services/entraToken.js',
  );
});
