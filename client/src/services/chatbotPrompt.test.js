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
    /\[lessonContext, deployedPromptVersion\]/,
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
