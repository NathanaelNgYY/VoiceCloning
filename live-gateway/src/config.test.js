import assert from 'node:assert/strict';
import test from 'node:test';

import { isAuthExemptOrigin, parseCorsOrigins, readinessProblems } from './config.js';

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

test('a multi-origin CORS value becomes a list the cors package can match', () => {
  // The bug this guards: `cors` compares a string origin with `===`, so handing
  // it the raw comma-joined value rejects every browser request once a second
  // origin is configured. Nothing caught it until the sign-in route, because the
  // WebSocket is not subject to CORS.
  assert.deepEqual(
    parseCorsOrigins('https://a.cloudfront.net,https://lectures.lkcmedicine.org'),
    ['https://a.cloudfront.net', 'https://lectures.lkcmedicine.org'],
  );
});

test('a single origin is still a list, not a bare string', () => {
  assert.deepEqual(parseCorsOrigins('https://a.cloudfront.net'), ['https://a.cloudfront.net']);
});

test('surrounding whitespace and empty entries are ignored', () => {
  assert.deepEqual(parseCorsOrigins(' https://a.net , , https://b.net '), ['https://a.net', 'https://b.net']);
});

test('an unset or wildcard value stays a wildcard', () => {
  for (const value of ['*', '', '   ', undefined, null, ',,']) {
    assert.equal(parseCorsOrigins(value), '*', `expected wildcard for ${JSON.stringify(value)}`);
  }
});

test('isAuthExemptOrigin only exempts listed origins', () => {
  const exempt = ['https://d3k2rz0hqm8nxi.cloudfront.net'];
  assert.equal(isAuthExemptOrigin('https://d3k2rz0hqm8nxi.cloudfront.net', exempt), true);
  // Trailing slash is the same origin.
  assert.equal(isAuthExemptOrigin('https://d3k2rz0hqm8nxi.cloudfront.net/', exempt), true);
  // The SSO-backed distribution must keep needing a token.
  assert.equal(isAuthExemptOrigin('https://d25sg72wp8oj5g.cloudfront.net', exempt), false);
  // A non-browser client sending no Origin is never exempt.
  assert.equal(isAuthExemptOrigin('', exempt), false);
  // Empty allowlist means the exemption is off entirely.
  assert.equal(isAuthExemptOrigin('https://d3k2rz0hqm8nxi.cloudfront.net', []), false);
});
