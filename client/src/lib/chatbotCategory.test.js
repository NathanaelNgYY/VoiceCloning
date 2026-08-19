import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHATBOT_CATEGORY,
  chatbotCategoryStorageSuffix,
  isValidChatbotCategory,
  normalizeChatbotCategory,
} from './chatbotCategory.js';

test('a blank category means the default one', () => {
  for (const blank of ['', '   ', null, undefined]) {
    assert.equal(normalizeChatbotCategory(blank), DEFAULT_CHATBOT_CATEGORY);
  }
});

test('case is folded rather than making a second lecture', () => {
  // Lecture slugs are lowercase, so "GI-Bleeding" deployed as its own category
  // would be a lecture the site can never route to.
  assert.equal(normalizeChatbotCategory('GI-Bleeding'), 'gi-bleeding');
  assert.equal(normalizeChatbotCategory('  gi-bleeding  '), 'gi-bleeding');
});

test('ids that could escape the S3 prefix are rejected', () => {
  // The id is concatenated into an object key on the server, so this is a
  // path-safety boundary and not only a naming rule.
  for (const bad of ['../secrets', 'a/b', 'dot.dot', '-leading', 'under_score', 'x'.repeat(65)]) {
    assert.equal(normalizeChatbotCategory(bad), '', `${bad} should be rejected`);
    assert.equal(isValidChatbotCategory(bad), false);
  }
  assert.equal(isValidChatbotCategory('gi-bleeding'), true);
  assert.equal(isValidChatbotCategory('lecture2'), true);
});

test('the default category keeps the original unsuffixed storage key', () => {
  // A draft typed before categories existed must still be there afterwards.
  assert.equal(chatbotCategoryStorageSuffix(DEFAULT_CHATBOT_CATEGORY), '');
  assert.equal(chatbotCategoryStorageSuffix(''), '');
  assert.equal(chatbotCategoryStorageSuffix('gi-bleeding'), ':gi-bleeding');
});
