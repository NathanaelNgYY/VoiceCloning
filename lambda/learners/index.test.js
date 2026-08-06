import assert from 'node:assert/strict';
import test from 'node:test';

import { handleLearners } from './index.js';

const identity = { oid: 'user-1', roles: [], synthetic: false };
const guard = { authorize: async () => identity };
const repository = {
  getSummary: async (oid, lesson) => ({ oid, lesson, summary: 'Review risk stratification.' }),
  listUsers: async () => [{ oid: 'user-1', displayName: 'Student One' }],
  getUserLearningState: async (oid) => ({ profile: { oid }, lessons: [] }),
};

function event(path, queryStringParameters = null) {
  return { rawPath: path, headers: { authorization: 'Bearer token' }, queryStringParameters };
}

test('a student can load only their own learner summary', async () => {
  const response = await handleLearners(event('/api/learner/me', { lesson: 'gi-bleeding' }), {
    guard,
    repository,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).summary.oid, 'user-1');
});

test('an ordinary student cannot list other users', async () => {
  const response = await handleLearners(event('/api/supervisor/users'), {
    guard,
    repository,
    env: { SUPERVISOR_APP_ROLE: 'Supervisor' },
  });
  assert.equal(response.statusCode, 403);
});

test('a supervisor app role can list users and inspect learning state', async () => {
  const supervisorGuard = { authorize: async () => ({ ...identity, roles: ['Supervisor'] }) };
  const list = await handleLearners(event('/api/supervisor/users'), {
    guard: supervisorGuard,
    repository,
  });
  const detail = await handleLearners(event('/api/supervisor/users/user-1'), {
    guard: supervisorGuard,
    repository,
  });
  assert.equal(list.statusCode, 200);
  assert.equal(JSON.parse(list.body).users.length, 1);
  assert.equal(JSON.parse(detail.body).profile.oid, 'user-1');
});

test('a configured supervisor oid works before Entra app roles are provisioned', async () => {
  const response = await handleLearners(event('/api/supervisor/users'), {
    guard,
    repository,
    env: { SUPERVISOR_OIDS: 'user-1' },
  });
  assert.equal(response.statusCode, 200);
});
