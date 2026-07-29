import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { InferenceServer } from './inferenceServer.js';

function makeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

async function waitForSpawn() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('startup timeout terminates the child and permits a clean retry', async () => {
  const children = [];
  const server = new InferenceServer({
    spawnProcess: () => {
      const child = makeChild(1000 + children.length);
      children.push(child);
      return child;
    },
    startupTimeoutMs: 10,
  });
  server.probeReady = async () => false;
  server.terminateProcess = (child) => child.kill('SIGKILL');

  await assert.rejects(server.start(), /startup timed out/);
  assert.equal(children[0].killed, true);
  assert.equal(server.isRunning(), false);

  const retry = server.start();
  await waitForSpawn();
  children[1].stderr.write('Application startup complete');
  await retry;

  assert.equal(children.length, 2);
  assert.equal(server.isRunning(), true);
  assert.equal(server.ready, true);
});

test('a late close from an old child cannot clear the active process', async () => {
  const children = [];
  const server = new InferenceServer({
    spawnProcess: () => {
      const child = makeChild(2000 + children.length);
      children.push(child);
      return child;
    },
    startupTimeoutMs: 10,
  });
  server.probeReady = async () => false;
  server.terminateProcess = (child) => child.kill('SIGKILL');

  await assert.rejects(server.start(), /startup timed out/);
  const retry = server.start();
  await waitForSpawn();
  children[1].stdout.write('Uvicorn running');
  await retry;

  children[0].emit('close', null, 'SIGKILL');

  assert.equal(server.process, children[1]);
  assert.equal(server.ready, true);
});

test('exit before readiness rejects immediately and clears ownership', async () => {
  const child = makeChild(3000);
  const server = new InferenceServer({
    spawnProcess: () => child,
    startupTimeoutMs: 1000,
  });
  server.probeReady = async () => false;

  const starting = server.start();
  await waitForSpawn();
  child.emit('close', 1, null);

  await assert.rejects(starting, /exited before startup completed/);
  assert.equal(server.isRunning(), false);
  assert.equal(server.ready, false);
});
