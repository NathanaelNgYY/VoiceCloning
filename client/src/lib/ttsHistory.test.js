import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addTtsHistoryItem,
  createTtsHistoryItem,
  getTtsHistoryByRoute,
} from './ttsHistory.js';

test('addTtsHistoryItem keeps previous generated audio and adds newest first', () => {
  const first = createTtsHistoryItem({
    route: 'fast',
    url: 'blob:first',
    text: 'first line',
    now: () => new Date('2026-06-16T10:00:00.000Z'),
  });
  const second = createTtsHistoryItem({
    route: 'fast',
    url: 'blob:second',
    text: 'second line',
    now: () => new Date('2026-06-16T10:01:00.000Z'),
  });

  const history = addTtsHistoryItem(addTtsHistoryItem([], first), second);

  assert.deepEqual(history.map((item) => item.url), ['blob:second', 'blob:first']);
});

test('getTtsHistoryByRoute separates live fast and full inference results', () => {
  const fast = createTtsHistoryItem({ route: 'fast', url: 'blob:fast', text: 'fast' });
  const full = createTtsHistoryItem({ route: 'full', url: 'blob:full', text: 'full' });
  const history = addTtsHistoryItem(addTtsHistoryItem([], fast), full);

  assert.deepEqual(getTtsHistoryByRoute(history, 'fast').map((item) => item.url), ['blob:fast']);
  assert.deepEqual(getTtsHistoryByRoute(history, 'full').map((item) => item.url), ['blob:full']);
});
