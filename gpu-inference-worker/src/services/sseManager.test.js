import assert from 'node:assert/strict';
import test from 'node:test';

import { SSEManager } from './sseManager.js';

test('clearing a terminal session releases stale local prepared state', () => {
  const manager = new SSEManager();
  manager.prepareSession('completed-session');

  assert.equal(manager.hasPreparedSession('completed-session'), true);
  manager.clearSession('completed-session');
  assert.equal(manager.hasPreparedSession('completed-session'), false);
});
