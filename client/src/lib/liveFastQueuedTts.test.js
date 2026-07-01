import test from 'node:test';
import assert from 'node:assert/strict';

import { generateLiveFastQueuedTts } from './liveFastQueuedTts.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function tick() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

test('generateLiveFastQueuedTts emits the first clip while later clips are still generating', async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  const events = [];

  const generation = generateLiveFastQueuedTts({
    text: 'First sentence. Second sentence.',
    baseParams: { voiceProfileId: 'alex-v1', text_lang: 'en' },
    // Inject the splitter so this test exercises the queue's progressive emission
    // regardless of how the default chunker groups sentences (chunking is covered by
    // splitLiveReplyChunks' own tests).
    splitText: (value) => value.split('. ').map((part) => part.trim()).filter(Boolean),
    createObjectUrl: (blob) => `blob:${blob.id}`,
    synthesizeSentence: async (params) => {
      calls.push(params.text);
      if (calls.length === 1) return first.promise;
      return second.promise;
    },
    onClipReady: (clip) => events.push(`ready:${clip.index}:${clip.url}`),
  });

  first.resolve({ blob: { id: 'first' } });
  await tick();

  assert.deepEqual(events, ['ready:0:blob:first']);
  assert.deepEqual(calls, ['First sentence', 'Second sentence.']);

  second.resolve({ blob: { id: 'second' } });
  const result = await generation;

  assert.deepEqual(events, ['ready:0:blob:first', 'ready:1:blob:second']);
  assert.deepEqual(result.clips.map((clip) => clip.url), ['blob:first', 'blob:second']);
});
