import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { __setStorePathForTests } from '../services/systemPromptStore.js';
import { handleGetSystemPrompt, handlePutSystemPrompt } from './systemPrompt.js';

function tmpStorePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sysprompt-route-')), 'store.json');
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('GET returns null when the store is unset', () => {
  __setStorePathForTests(tmpStorePath());
  const res = mockRes();
  handleGetSystemPrompt({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { systemPrompt: null });
});

test('PUT persists a string and GET reads it back', () => {
  __setStorePathForTests(tmpStorePath());
  const putRes = mockRes();
  handlePutSystemPrompt({ body: { systemPrompt: 'Hello shared' } }, putRes);
  assert.equal(putRes.statusCode, 200);
  assert.deepEqual(putRes.body, { systemPrompt: 'Hello shared' });

  const getRes = mockRes();
  handleGetSystemPrompt({}, getRes);
  assert.deepEqual(getRes.body, { systemPrompt: 'Hello shared' });
});

test('PUT rejects a non-string body with 400', () => {
  __setStorePathForTests(tmpStorePath());
  const res = mockRes();
  handlePutSystemPrompt({ body: { systemPrompt: 123 } }, res);
  assert.equal(res.statusCode, 400);
});

test('PUT rejects a missing body with 400', () => {
  __setStorePathForTests(tmpStorePath());
  const res = mockRes();
  handlePutSystemPrompt({}, res);
  assert.equal(res.statusCode, 400);
});
