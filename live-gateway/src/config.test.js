import assert from 'node:assert/strict';
import test from 'node:test';

import { readinessProblems } from './config.js';

const READY = {
  OPENAI_API_KEY: 'sk-test',
};

test('a gateway with its OpenAI key set is ready', () => {
  assert.deepEqual(readinessProblems(READY), []);
});

test('a missing OpenAI key is not ready', () => {
  // The process starts fine without it and then fails every conversation, which
  // is exactly the case /readyz exists to catch.
  const problems = readinessProblems({});

  assert.equal(problems.length, 1);
  assert.match(problems[0], /OPENAI_API_KEY/);
});

test('authentication turned on without a tenant or audience is not ready', () => {
  const problems = readinessProblems({ ...READY, LIVE_AUTH_ENABLED: 'true' });

  assert.equal(problems.length, 3);
  assert.match(problems.join(' '), /ENTRA_TENANT_ID/);
  assert.match(problems.join(' '), /ENTRA_AUDIENCE/);
  assert.match(problems.join(' '), /ENTRA_ALLOWED_EMAIL_DOMAINS/);
});

test('every problem is reported at once, not just the first', () => {
  // One restart should surface the whole list rather than one problem per deploy.
  const problems = readinessProblems({ LIVE_AUTH_ENABLED: 'true' });

  assert.equal(problems.length, 4);
});

test('a fully configured authenticating gateway is ready', () => {
  assert.deepEqual(readinessProblems({
    ...READY,
    LIVE_AUTH_ENABLED: 'true',
    ENTRA_TENANT_ID: '45e82b6b-5ac4-41a7-a36f-e702e5e3a355',
    ENTRA_AUDIENCE: 'api://9b5c52c0-5f02-4dbf-83ac-c68d246abc68',
    ENTRA_ALLOWED_EMAIL_DOMAINS: 'assoc.main.ntu.edu.sg',
  }), []);
});

test('a transcript table with no authentication in front of it is not ready', () => {
  // Transcripts are only written for authenticated sessions, so this combination
  // silently stores nothing — a failure with no error anywhere.
  const problems = readinessProblems({ ...READY, TRANSCRIPT_TABLE_NAME: 'vcs-staging-transcripts' });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /no transcript would be stored/);
});

test('authentication without a transcript table is a valid configuration', () => {
  assert.deepEqual(readinessProblems({
    ...READY,
    LIVE_AUTH_ENABLED: 'true',
    ENTRA_TENANT_ID: 'tenant',
    ENTRA_AUDIENCE: 'api://client',
    ENTRA_ALLOWED_EMAIL_DOMAINS: 'assoc.main.ntu.edu.sg',
  }), []);
});
