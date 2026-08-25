import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ElevenLabsError,
  buildElevenLabsProfileId,
  isElevenLabsConfigured,
  isElevenLabsRequest,
  listElevenLabsVoices,
  parseElevenLabsVoiceId,
  synthesizeElevenLabsSpeech,
} from './elevenLabs.js';

const ENV = { ELEVENLABS_API_KEY: 'test-key' };

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    headers: { get: () => 'application/json' },
  };
}

function audioResponse(bytes, contentType = 'audio/mpeg') {
  return {
    ok: true,
    status: 200,
    // TextEncoder gives an exactly-sized ArrayBuffer; Buffer.from().buffer would
    // hand back Node's shared 8KB pool and the assertion would read past the data.
    arrayBuffer: async () => new TextEncoder().encode(bytes).buffer,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
  };
}

test('a voiceProfileId round-trips through the elevenlabs namespace', () => {
  assert.equal(buildElevenLabsProfileId('abc123'), 'elevenlabs:abc123');
  assert.equal(parseElevenLabsVoiceId('elevenlabs:abc123'), 'abc123');
  assert.equal(parseElevenLabsVoiceId('deanvoice-v1'), '');
  assert.equal(parseElevenLabsVoiceId(''), '');
});

test('a cloned voice is never mistaken for a standard one', () => {
  assert.equal(isElevenLabsRequest({ voiceProfileId: 'deanvoice-v1' }), false);
  assert.equal(isElevenLabsRequest({ voiceProfileId: 'elevenlabs:xyz' }), true);
  assert.equal(isElevenLabsRequest({}), false);
});

test('an unconfigured server reports no standard voices rather than failing', async () => {
  assert.equal(isElevenLabsConfigured({}), false);
  const voices = await listElevenLabsVoices({
    env: {},
    fetchImpl: () => { throw new Error('should not be called'); },
    cache: { expiresAt: 0, voices: [] },
  });
  assert.deepEqual(voices, []);
});

test('the default (premade) list is summarized and sorted by name', async () => {
  const voices = await listElevenLabsVoices({
    env: ENV,
    cache: { expiresAt: 0, voices: [] },
    fetchImpl: async () => jsonResponse({
      voices: [
        { voice_id: 'v2', name: 'Zara', labels: { accent: 'british', gender: 'female' } },
        { voice_id: 'v1', name: 'Adam', labels: {} },
      ],
    }),
  });

  assert.deepEqual(voices.map((voice) => voice.displayName), ['Adam', 'Zara']);
  assert.equal(voices[0].voiceProfileId, 'elevenlabs:v1');
  assert.equal(voices[0].provider, 'elevenlabs');
  // Owned by nobody, and always ready — the faculty panel relies on both.
  assert.equal(voices[0].isMine, false);
  assert.equal(voices[0].hasSavedProfile, true);
  assert.equal(voices[1].accent, 'british');
});

test('an allowlist resolves each id directly, not by filtering a listing', async () => {
  // Regression: the shared community library is paginated and does not contain
  // the premade voices a shortlist names, so filtering it returned nothing.
  const urls = [];
  const byId = { v1: 'Adam', v3: 'Nia' };
  const voices = await listElevenLabsVoices({
    env: { ...ENV, ELEVENLABS_VOICE_IDS: 'v1, v3' },
    cache: { expiresAt: 0, voices: [] },
    fetchImpl: async (url) => {
      urls.push(url);
      const id = url.split('/').pop();
      return jsonResponse({ voice_id: id, name: byId[id] });
    },
  });

  assert.deepEqual(voices.map((voice) => voice.displayName), ['Adam', 'Nia']);
  assert.ok(urls.every((url) => url.includes('/v1/voices/')), 'each id is fetched directly');
  assert.equal(urls.length, 2);
});

test('with no allowlist the curated premade set is used, not the community library', async () => {
  const urls = [];
  await listElevenLabsVoices({
    env: ENV,
    cache: { expiresAt: 0, voices: [] },
    fetchImpl: async (url) => { urls.push(url); return jsonResponse({ voices: [] }); },
  });
  assert.match(urls[0], /voice_type=default/u);
});

test('one bad id drops that voice instead of emptying the shortlist', async () => {
  const voices = await listElevenLabsVoices({
    env: { ...ENV, ELEVENLABS_VOICE_IDS: 'good,bad' },
    cache: { expiresAt: 0, voices: [] },
    fetchImpl: async (url) => (url.endsWith('/bad')
      ? jsonResponse({ detail: 'nope' }, { ok: false, status: 404 })
      : jsonResponse({ voice_id: 'good', name: 'Alice' })),
  });
  assert.deepEqual(voices.map((v) => v.displayName), ['Alice']);
});

test('an ElevenLabs outage leaves the list empty instead of throwing', async () => {
  const voices = await listElevenLabsVoices({
    env: ENV,
    cache: { expiresAt: 0, voices: [] },
    fetchImpl: async () => { throw new Error('network down'); },
  });
  assert.deepEqual(voices, []);
});

test('synthesis posts the voice id, model and text, returning the upstream content type', async () => {
  const calls = [];
  const result = await synthesizeElevenLabsSpeech(
    { voiceProfileId: 'elevenlabs:v1', text: '  Hello there.  ' },
    {
      env: ENV,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return audioResponse('ID3audio');
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/text-to-speech\/v1\?output_format=mp3_44100_128$/u);
  assert.equal(calls[0].init.headers['xi-api-key'], 'test-key');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.text, 'Hello there.');
  assert.equal(body.model_id, 'eleven_flash_v2_5');
  assert.equal(result.contentType, 'audio/mpeg');
  assert.equal(result.characterCount, 'Hello there.'.length);
  assert.equal(result.buffer.toString(), 'ID3audio');
});

test('an over-long text is rejected rather than silently truncated', async () => {
  await assert.rejects(
    () => synthesizeElevenLabsSpeech(
      { voiceProfileId: 'elevenlabs:v1', text: 'x'.repeat(50) },
      { env: { ...ENV, ELEVENLABS_MAX_CHARS: '10' }, fetchImpl: async () => audioResponse('nope') },
    ),
    (error) => error instanceof ElevenLabsError && error.statusCode === 400,
  );
});

test('a missing API key surfaces as 503, not a crash', async () => {
  await assert.rejects(
    () => synthesizeElevenLabsSpeech(
      { voiceProfileId: 'elevenlabs:v1', text: 'Hello.' },
      { env: {}, fetchImpl: async () => audioResponse('nope') },
    ),
    (error) => error.statusCode === 503,
  );
});

test('upstream quota and auth failures map to distinct statuses', async () => {
  const failWith = (status) => synthesizeElevenLabsSpeech(
    { voiceProfileId: 'elevenlabs:v1', text: 'Hello.' },
    {
      env: ENV,
      fetchImpl: async () => ({
        ok: false,
        status,
        text: async () => '{"detail":"upstream"}',
        headers: { get: () => null },
      }),
    },
  );

  await assert.rejects(() => failWith(429), (error) => error.statusCode === 429);
  await assert.rejects(() => failWith(401), (error) => error.statusCode === 503);
  await assert.rejects(() => failWith(500), (error) => error.statusCode === 502);
});
