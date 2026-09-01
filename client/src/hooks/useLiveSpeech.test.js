import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./useLiveSpeech.js', import.meta.url), 'utf8');

test('live chat reports authentication failure instead of silently closing', () => {
  assert.match(source, /case 'session\.auth\.failed':/u);
  assert.match(source, /Live chat sign-in failed/u);
});

test('live chat cannot remain in preparing state indefinitely', () => {
  assert.match(source, /LIVE_SESSION_READY_TIMEOUT_MS = 15_000/u);
  assert.match(source, /Live chat setup timed out before the AI session became ready/u);
  assert.match(source, /case 'session\.ready':[\s\S]*?clearTimeout\(sessionReadyTimerRef\.current\)/u);
});

test('live voice synthesis keeps the answer and retries capacity automatically', () => {
  assert.match(source, /runSynthesisWithRetry\(run/u);
  assert.match(source, /capacityWaitMessage\(err, \{ autoRetry: true \}\)/u);
  assert.match(source, /isCancelled: \(\) => isCancelledRef\.current/u);
});

test('successful synthesis clears an older capacity-wait banner', () => {
  assert.match(
    source,
    /runSynthesisWithRetry\(run,[\s\S]*?setErrorState\(\(current\) => current\?\.tone === 'waiting' \? null : current\)/u,
  );
});
