import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { assembleSystemPrompt } from './assembleSystemPrompt.js';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const DOC = { name: 'paper.pdf', text: 'Findings.', chars: 9 };

test('prompt alone passes through unchanged', () => {
  assert.equal(assembleSystemPrompt({ prompt: 'PROMPT' }), 'PROMPT');
});

test('sections are ordered prompt, documents, lesson', () => {
  const result = assembleSystemPrompt({
    prompt: 'PROMPT',
    documents: [DOC],
    lessonContext: 'LESSON',
  });

  const promptAt = result.indexOf('PROMPT');
  const docsAt = result.indexOf('# Uploaded Reference Documents');
  const lessonAt = result.indexOf('LESSON');

  assert.ok(promptAt < docsAt, 'documents follow the prompt');
  assert.ok(docsAt < lessonAt, 'lesson context is last');
});

test('empty sections are omitted rather than left as blank gaps', () => {
  assert.equal(
    assembleSystemPrompt({ prompt: 'PROMPT', documents: [], lessonContext: '   ' }),
    'PROMPT',
  );
  assert.equal(
    assembleSystemPrompt({ prompt: 'PROMPT', lessonContext: 'LESSON' }),
    'PROMPT\n\nLESSON',
  );
});

test('sections are separated by exactly one blank line', () => {
  assert.equal(
    assembleSystemPrompt({ prompt: 'PROMPT', lessonContext: 'LESSON' }),
    'PROMPT\n\nLESSON',
  );
});

test('missing arguments produce an empty prompt rather than throwing', () => {
  assert.equal(assembleSystemPrompt(), '');
  assert.equal(assembleSystemPrompt({ documents: null, lessonContext: null }), '');
});

test('the faculty and lecture sites agree given the same deployed config', () => {
  // Both sites resolve their inputs differently (local override vs deployed-only)
  // but assemble them identically. This is the property the lecturer relies on
  // when they test on faculty and deploy to lectures.
  const deployed = { prompt: 'PROMPT', documents: [DOC] };

  const faculty = assembleSystemPrompt(deployed);
  const lecture = assembleSystemPrompt({ ...deployed, lessonContext: '' });

  assert.equal(faculty, lecture);
});

/**
 * The regression guard for the whole bug class: every prompt defect here has been
 * one site assembling a section the other did not. Behavioural tests cannot catch
 * that — a second, divergent assembly path passes them all — so this asserts the
 * structural rule instead.
 */
test('no site assembles a system prompt outside assembleSystemPrompt', () => {
  const callSites = [
    join(SRC_DIR, 'pages', 'LivePage.jsx'),
    join(SRC_DIR, 'hooks', 'useGiChatEngine.js'),
  ];

  for (const file of callSites) {
    const source = readFileSync(file, 'utf-8');
    assert.match(
      source,
      /assembleSystemPrompt\(/,
      `${file} must build its system prompt via assembleSystemPrompt`,
    );
  }

  // The old ad-hoc helper is gone; nothing may reintroduce a second path.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(js|jsx)$/.test(entry.name) && !entry.name.endsWith('.test.js')) {
        if (readFileSync(full, 'utf-8').includes('combineSystemPromptWithDocuments')) {
          offenders.push(full);
        }
      }
    }
  };
  walk(SRC_DIR);

  assert.deepEqual(offenders, [], 'combineSystemPromptWithDocuments was replaced by assembleSystemPrompt');
});
