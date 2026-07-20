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

test('normalizeAppMode resolves chatbot and its aliases', () => {
  assert.equal(normalizeAppMode('chatbot'), 'chatbot');
  assert.equal(normalizeAppMode('dean'), 'chatbot');
  assert.equal(normalizeAppMode('kiosk'), 'chatbot');
});

test('getAppModeConfig exposes only the chatbot with no nav in chatbot mode', () => {
  const config = getAppModeConfig('chatbot');

  assert.equal(config.kiosk, true);
  assert.equal(config.showTraining, false);
  assert.equal(config.showLiveFast, true);
  assert.equal(config.showTextToSpeech, false);
  assert.equal(config.defaultPath, '/');
  assert.equal(config.subtitle, 'Live Fast Chatbot');
  assert.deepEqual(config.navItems, []);
});

test('getAppModeConfig leaves live-fast mode unchanged', () => {
  const config = getAppModeConfig('live-fast');
  assert.equal(config.kiosk, false);
  assert.deepEqual(config.navItems.map((i) => i.label), ['Live Fast', 'Text to Speech']);
});

test('getAppModeConfig defaults the live engine to fast in every mode', () => {
  assert.equal(getAppModeConfig('chatbot').defaultLiveEngine, 'fast');
  assert.equal(getAppModeConfig('combined').defaultLiveEngine, 'fast');
  assert.equal(getAppModeConfig('live-fast').defaultLiveEngine, 'fast');
  assert.equal(getAppModeConfig('training').defaultLiveEngine, 'fast');
});

test('normalizeAppMode resolves the gi mode', () => {
  assert.equal(normalizeAppMode('gi'), 'gi');
  assert.equal(normalizeAppMode('GI'), 'gi');
  assert.equal(normalizeAppMode('gi-bleeding'), 'gi');
});

test('getAppModeConfig exposes only the gi chat in gi mode', () => {
  const config = getAppModeConfig('gi');

  assert.equal(config.kiosk, true);
  assert.equal(config.showGiChat, true);
  assert.equal(config.showTraining, false);
  assert.equal(config.showLiveFast, false);
  assert.equal(config.showTextToSpeech, false);
  assert.equal(config.defaultPath, '/');
  assert.equal(config.subtitle, 'GI Bleeding Chatbot');
  assert.deepEqual(config.navItems, []);
});

test('getAppModeConfig leaves showGiChat false in every other mode', () => {
  for (const mode of ['combined', 'training', 'live-fast', 'chatbot']) {
    assert.equal(getAppModeConfig(mode).showGiChat, false, `${mode} must not show gi chat`);
  }
});

test('getAppModeConfig keeps chatbot mode unchanged after adding gi', () => {
  const config = getAppModeConfig('chatbot');
  assert.equal(config.kiosk, true);
  assert.equal(config.showLiveFast, true);
  assert.equal(config.subtitle, 'Live Fast Chatbot');
});
