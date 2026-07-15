import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEmphasisAndSpelling } from './emphasisAndSpelling.js';
import { prepareTextForSynthesis } from './textPronunciation.js';

// Deterministic stubs so tests don't depend on a CMU file on disk.
const acronyms = new Set(['WHO']);
const realWords = new Set(['REALLY', 'STOP', 'GO', 'WHO', 'IMPORTANT', 'ORDER', 'AN', 'NOW', 'THE', 'IS', 'THIS', 'WAIT', 'SAYS']);
const isRealWord = (w) => realWords.has(String(w).toUpperCase());
const opts = { acronyms, isRealWord };

// Production order: prepareTextForSynthesis(applyEmphasisAndSpelling(text, opts)).
const pipeline = (text) => prepareTextForSynthesis(applyEmphasisAndSpelling(text, opts));

// Every sentence-terminal punctuation that is followed by a letter must have
// whitespace between them, or longTextInference's sentence splitter fuses words.
function assertNoSentenceGlue(result) {
  assert.doesNotMatch(result, /[.!?][A-Za-z]/u, `words glued across sentence punctuation: ${result}`);
}

for (const input of ['Wait. STOP now.', 'The WHO says STOP.', 'order an ECG; STOP.']) {
  test(`pipeline keeps sentences un-glued and comma-clean for: "${input}"`, () => {
    const result = pipeline(input);
    assertNoSentenceGlue(result);
    assert.doesNotMatch(result, /,,/u, `doubled comma in: ${result}`);
    assert.doesNotMatch(result, /,\s*,/u, `doubled comma in: ${result}`);
  });
}

test('pipeline preserves the WHO spell-out', () => {
  assert.match(pipeline('The WHO says STOP.'), /double you aitch oh/u);
});

test('pipeline preserves the ECG spell-out', () => {
  assert.match(pipeline('order an ECG; STOP.'), /ee cee gee/u);
});

test('pipeline preserves the sentence boundary after a dotted initialism', () => {
  assert.equal(pipeline('The F.A.D. Another sentence follows.'), 'The eff ay dee. Another sentence follows.');
});

test('pipeline does not glue the emphasis after the period in "Wait. STOP now."', () => {
  const result = pipeline('Wait. STOP now.');
  assertNoSentenceGlue(result);
  assert.match(result, /Wait\.\s/u);
});
