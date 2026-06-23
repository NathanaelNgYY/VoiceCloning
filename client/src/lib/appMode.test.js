import test from 'node:test';
import assert from 'node:assert/strict';

import { getAppModeConfig, normalizeAppMode } from './appMode.js';

test('normalizeAppMode keeps the combined app as the default', () => {
  assert.equal(normalizeAppMode(undefined), 'combined');
  assert.equal(normalizeAppMode(''), 'combined');
  assert.equal(normalizeAppMode('unknown'), 'combined');
});

test('getAppModeConfig exposes both apps in combined mode', () => {
  const config = getAppModeConfig('combined');

  assert.equal(config.showTraining, true);
  assert.equal(config.showLiveFast, true);
  assert.equal(config.defaultPath, '/');
  assert.deepEqual(
    config.navItems.map((item) => item.label),
    ['Training', 'Live Fast', 'Text to Speech'],
  );
});

test('getAppModeConfig exposes only training in training mode', () => {
  const config = getAppModeConfig('training');

  assert.equal(config.showTraining, true);
  assert.equal(config.showLiveFast, false);
  assert.equal(config.defaultPath, '/');
  assert.deepEqual(
    config.navItems.map((item) => item.label),
    ['Training'],
  );
});

test('getAppModeConfig exposes only live fast in live-fast mode', () => {
  const config = getAppModeConfig('live-fast');

  assert.equal(config.showTraining, false);
  assert.equal(config.showLiveFast, true);
  assert.equal(config.showTextToSpeech, true);
  assert.equal(config.defaultPath, '/');
  assert.deepEqual(
    config.navItems.map((item) => item.to),
    ['/', '/?tab=text-to-speech'],
  );
  assert.deepEqual(
    config.navItems.map((item) => item.label),
    ['Live Fast', 'Text to Speech'],
  );
});
