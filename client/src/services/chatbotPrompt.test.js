import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * These assert the deployed-config refresh contract structurally. The modules
 * themselves import through the `@/` Vite alias, which `node --test` cannot
 * resolve, so behaviour is covered by the assembler and document tests and the
 * wiring is pinned here.
 */

test('the lecture engine refreshes the deployed config when a chat ends', () => {
  const source = readFileSync(join(SRC_DIR, 'hooks', 'useGiChatEngine.js'), 'utf-8');

  assert.match(source, /refreshDeployedPrompt\(\)/, 'refreshes the deployed config');
  assert.match(
    source,
    /liveSpeech\.phase === 'idle' && previous !== 'idle'/,
    'refreshes on the transition into idle, not on every idle render',
  );
  assert.match(
    source,
    /\[[^\]]*deployedPromptVersion[^\]]*\]/,
    'the prompt memo depends on the deployed-config version, or deploys are ignored',
  );
});

test('a documents-only deploy is publishable but an empty one is not', () => {
  const source = readFileSync(join(SRC_DIR, 'services', 'chatbotPrompt.js'), 'utf-8');

  // Documents alone are a valid assistant; neither half is not.
  assert.match(source, /!body\.trim\(\) && docs\.length === 0/);
});

test('a failed fetch never overwrites a loaded config', () => {
  const source = readFileSync(join(SRC_DIR, 'hooks', 'useDeployedChatbotPrompt.js'), 'utf-8');

  // fetchDeployedChatbotSystemPrompt reports failure as empty values; treating
  // that as real config would drop a working assistant to the bundled default.
  assert.match(source, /if \(!prompt\.trim\(\) && documents\.length === 0\) return;/);
  // An unchanged poll must not churn the memo on every conversation end.
  assert.match(source, /if \(next === fingerprintRef\.current\) return;/);
});

test('every prompt request names a category', () => {
  const source = readFileSync(join(SRC_DIR, 'services', 'chatbotPrompt.js'), 'utf-8');

  // Each category is a separate stored assistant. A request with no category
  // would read or, worse, overwrite the wrong lecture.
  assert.match(source, /\?category=\$\{encodeURIComponent\(normalized\)\}/);
  assert.match(source, /fetchImpl\(promptUrl\(category\), \{ cache: 'no-store' \}\)/);
  assert.match(source, /fetchImpl\(promptUrl\(category\), \{[\s\S]{0,20}method: 'PUT'/);
});

test('a lesson runs the assistant deployed for its own slug', () => {
  const source = readFileSync(join(SRC_DIR, 'pages', 'LessonPage.jsx'), 'utf-8');

  // Without this the lecture site reads the default category and every lesson
  // answers with the same instructions — the single shared prompt categories
  // exist to replace.
  assert.match(source, /category=\{slug\}/);
});

test("the engine takes the lesson's category as a parameter", () => {
  const source = readFileSync(join(SRC_DIR, 'hooks', 'useGiChatEngine.js'), 'utf-8');

  // The category has to be declared, not just used: forwarding an undeclared
  // `category` to useDeployedChatbotPrompt throws a ReferenceError on render and
  // takes the whole lecture page down with it, which is how the shipped bundle
  // rendered nothing at all.
  assert.match(
    source,
    /export function useGiChatEngine\(\{[^}]*category[^}]*\} = \{\}\)/,
  );
  assert.match(source, /useDeployedChatbotPrompt\(\{ category \}\)/);

  // And the panel between the lesson page and the engine has to pass it along.
  const panel = readFileSync(join(SRC_DIR, 'components', 'gi', 'GiChatPanel.jsx'), 'utf-8');
  assert.match(panel, /export function GiChatPanel\(\{[^}]*category[^}]*\}\)/);
  assert.match(panel, /useGiChatEngine\(\{[^}]*category[^}]*\}\)/);
});

test('the editor scopes its browser-local draft to the lecture being edited', () => {
  const source = readFileSync(join(SRC_DIR, 'pages', 'LivePage.jsx'), 'utf-8');

  // A draft is allowed to outrank the deployed text, so an unscoped draft would
  // carry one lecture's instructions into another lecture's deploy.
  for (const call of [
    /persistChatbotSystemPrompt\(value, \{ category: chatbotCategory \}\)/,
    /clearChatbotSystemPrompt\(\{ category: chatbotCategory \}\)/,
    /persistChatbotDocuments\(next, \{ category: chatbotCategory \}\)/,
    /clearChatbotDocuments\(\{ category: chatbotCategory \}\)/,
    /hasStoredChatbotSystemPrompt\(\{ category: chatbotCategory \}\)/,
    /hasStoredChatbotDocuments\(\{ category: chatbotCategory \}\)/,
  ]) {
    assert.match(source, call);
  }

  // And the deploy publishes to the selected lecture, not to whatever was last
  // loaded. The window is generous because the call also carries the published
  // voice and the comment explaining it.
  assert.match(source, /deployChatbotSystemPrompt\(\{[\s\S]{0,600}category: chatbotCategory,/);

  // The lecturer's selected voice is published with the lecture; without this
  // the lecture site keeps whatever its build pinned, so the lecturer would hear
  // one voice while approving a lecture that speaks in another.
  assert.match(source, /deployChatbotSystemPrompt\(\{[\s\S]{0,600}voiceProfileId: speakingVoiceProfileId,/);
});

test('the lecture engine names the voice the lecturer picked, not its raw id', () => {
  // A stock voice's id ("elevenlabs:Xb7hH8MSUJpSbSDYk0k2") is an opaque handle.
  // The faculty picker names it "Alice - Clear, Engaging Educator", and the
  // student beside the same lecture must see those same words.
  const source = readFileSync(join(SRC_DIR, 'hooks', 'useGiChatEngine.js'), 'utf-8');

  assert.match(
    source,
    /publishedVoiceDisplayName/,
    'the engine reads the published voice name',
  );
  assert.match(
    source,
    /activeVoiceLabel = requestedVoiceProfileId\s*\?\s*\(\(publishedVoiceIsInForce/,
    'the label prefers the published name over the id',
  );
  assert.match(
    source,
    /describeVoiceForDisplay\(requestedVoiceProfileId\)/,
    'an unresolved voice is described, never shown as a raw id',
  );
});

test('the published voice name only names the voice actually in force', () => {
  // The build pin and the bundled course mapping both outrank nothing, but the
  // published id can lose to neither — labelling a pinned voice with the
  // published lecture\u2019s name would name the wrong voice on screen.
  const source = readFileSync(join(SRC_DIR, 'hooks', 'useGiChatEngine.js'), 'utf-8');

  assert.match(
    source,
    /publishedVoiceIsInForce\s*=[\s\S]{0,200}requestedVoiceProfileId === String\(publishedVoiceProfileId/,
    'the name is used only when the published voice is the one requested',
  );
});

test('the deployed-config fetch carries the published voice name', () => {
  const source = readFileSync(join(SRC_DIR, 'services', 'chatbotPrompt.js'), 'utf-8');

  assert.match(
    source,
    /voiceDisplayName: typeof data\?\.voiceDisplayName === 'string' \? data\.voiceDisplayName : ''/,
    'the name is read off the response',
  );
  // A failed fetch must report a name-shaped empty, not undefined, or the hook
  // would set undefined and the label would read "undefined" on screen.
  assert.match(source, /const empty = \{[\s\S]{0,300}voiceDisplayName: '',/);
});
