import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getSystemPrompt,
  setSystemPrompt,
  loadSystemPrompt,
  __setStorePathForTests,
} from './systemPromptStore.js';

function tmpStorePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sysprompt-')), 'store.json');
}

test('unset store returns null', () => {
  __setStorePathForTests(tmpStorePath());
  assert.equal(getSystemPrompt(), null);
});

test('set then get returns the stored value', () => {
  __setStorePathForTests(tmpStorePath());
  assert.equal(setSystemPrompt('Shared prompt'), 'Shared prompt');
  assert.equal(getSystemPrompt(), 'Shared prompt');
});

test('set persists to the file as JSON', () => {
  const p = tmpStorePath();
  __setStorePathForTests(p);
  setSystemPrompt('Persisted');
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf-8')), { systemPrompt: 'Persisted' });
});

test('load restores from an existing file', () => {
  const p = tmpStorePath();
  fs.writeFileSync(p, JSON.stringify({ systemPrompt: 'From disk' }), 'utf-8');
  __setStorePathForTests(p);
  assert.equal(loadSystemPrompt(), 'From disk');
  assert.equal(getSystemPrompt(), 'From disk');
});

test('missing or corrupt file loads as null without throwing', () => {
  __setStorePathForTests(tmpStorePath()); // file does not exist yet
  assert.equal(loadSystemPrompt(), null);

  const p = tmpStorePath();
  fs.writeFileSync(p, 'not json', 'utf-8');
  __setStorePathForTests(p);
  assert.equal(loadSystemPrompt(), null);
});

test('setSystemPrompt rejects a non-string value', () => {
  __setStorePathForTests(tmpStorePath());
  assert.throws(() => setSystemPrompt(42), TypeError);
});
