import test from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from './index.js';

function createEvent({ method = 'GET', path = '/api/voice-profile/active', body, query } = {}) {
  return {
    requestContext: { http: { method } },
    rawPath: path,
    body: body === undefined ? undefined : JSON.stringify(body),
    queryStringParameters: query,
    headers: {},
  };
}

test('voice profile activate saves the full profile and marks it active', async () => {
  const uploads = [];
  const warmedProfiles = [];
  const handler = createHandler({
    readObject: async () => {
      throw new Error('not used');
    },
    writeObject: async (key, payload, contentType) => {
      uploads.push({
        key,
        contentType,
        body: JSON.parse(payload.toString('utf-8')),
      });
    },
    warmReferenceAudio: async (profile) => {
      warmedProfiles.push({
        ref_audio_path: profile.ref_audio_path,
        aux_ref_audio_paths: profile.aux_ref_audio_paths,
      });
    },
    now: () => '2026-05-18T10:00:00.000Z',
  });

  const response = await handler(createEvent({
    method: 'POST',
    path: '/api/voice-profile/activate',
    body: {
      voiceProfileId: 'michael-tan-v1',
      displayName: 'Michael Tan',
      gptKey: 'models/user-models/gpt/michael-tan.ckpt',
      sovitsKey: 'models/user-models/sovits/michael-tan.pth',
      ref_audio_path: 'training/datasets/michael-tan/reference.wav',
      prompt_text: 'Reference transcript',
      prompt_lang: 'en',
      text_lang: 'en',
      preferredRoute: 'sentence',
      aux_ref_audio_paths: ['training/datasets/michael-tan/aux1.wav'],
      defaults: {
        top_k: 5,
        top_p: 0.85,
        temperature: 0.7,
        repetition_penalty: 1.35,
        speed_factor: 1.0,
        max_chunk_words: 0,
        max_sentences_per_chunk: 1,
      },
    },
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    voiceProfileId: 'michael-tan-v1',
    displayName: 'Michael Tan',
    activatedAt: '2026-05-18T10:00:00.000Z',
  });
  assert.deepEqual(uploads, [
    {
      key: 'voice-profiles/michael-tan-v1.json',
      contentType: 'application/json',
      body: {
        voiceProfileId: 'michael-tan-v1',
        displayName: 'Michael Tan',
        gptKey: 'models/user-models/gpt/michael-tan.ckpt',
        sovitsKey: 'models/user-models/sovits/michael-tan.pth',
        ref_audio_path: 'training/datasets/michael-tan/reference.wav',
        prompt_text: 'Reference transcript',
        prompt_lang: 'en',
        text_lang: 'en',
        preferredRoute: 'sentence',
        aux_ref_audio_paths: ['training/datasets/michael-tan/aux1.wav'],
        defaults: {
          top_k: 5,
          top_p: 0.85,
          temperature: 0.7,
          repetition_penalty: 1.35,
          speed_factor: 1.0,
          max_chunk_words: 0,
          max_sentences_per_chunk: 1,
        },
        updatedAt: '2026-05-18T10:00:00.000Z',
      },
    },
    {
      key: 'voice-profiles/active.json',
      contentType: 'application/json',
      body: {
        voiceProfileId: 'michael-tan-v1',
        displayName: 'Michael Tan',
        gptKey: 'models/user-models/gpt/michael-tan.ckpt',
        sovitsKey: 'models/user-models/sovits/michael-tan.pth',
        ref_audio_path: 'training/datasets/michael-tan/reference.wav',
        prompt_text: 'Reference transcript',
        prompt_lang: 'en',
        text_lang: 'en',
        preferredRoute: 'sentence',
        aux_ref_audio_paths: ['training/datasets/michael-tan/aux1.wav'],
        defaults: {
          top_k: 5,
          top_p: 0.85,
          temperature: 0.7,
          repetition_penalty: 1.35,
          speed_factor: 1.0,
          max_chunk_words: 0,
          max_sentences_per_chunk: 1,
        },
        updatedAt: '2026-05-18T10:00:00.000Z',
        activatedAt: '2026-05-18T10:00:00.000Z',
      },
    },
  ]);
  assert.deepEqual(warmedProfiles, [{
    ref_audio_path: 'training/datasets/michael-tan/reference.wav',
    aux_ref_audio_paths: ['training/datasets/michael-tan/aux1.wav'],
  }]);
});

test('voice profile activate saves metadata layers for reproducible Live Fast configs', async () => {
  const uploads = [];
  const handler = createHandler({
    readObject: async () => {
      throw new Error('not used');
    },
    writeObject: async (key, payload) => {
      uploads.push({ key, body: JSON.parse(payload.toString('utf-8')) });
    },
    warmReferenceAudio: async () => {},
    now: () => '2026-06-10T01:00:00.000Z',
  });

  const response = await handler(createEvent({
    method: 'POST',
    path: '/api/voice-profile/activate',
    body: {
      voiceProfileId: 'metadata-voice-v1',
      displayName: 'Metadata Voice',
      gptKey: 'models/user-models/gpt/metadata.ckpt',
      sovitsKey: 'models/user-models/sovits/metadata.pth',
      ref_audio_path: 'training/datasets/metadata/denoised/ref.wav',
      prompt_text: 'This reference is clean and steady.',
      prompt_lang: 'en',
      text_lang: 'en',
      aux_ref_audio_paths: ['training/datasets/metadata/denoised/aux.wav'],
      defaults: { top_k: 5, speed_factor: 1 },
      metadata: {
        training: {
          engineVersion: 'v2ProPlus',
          skipDenoise: true,
          batchSize: 2,
          sovitsEpochs: 8,
          gptEpochs: 15,
        },
        reference: {
          mode: 'strict',
          primary: { path: 'training/datasets/metadata/denoised/ref.wav', score: 124 },
          aux: [{ path: 'training/datasets/metadata/denoised/aux.wav', score: 118 }],
        },
        liveFast: {
          configName: 'Default',
          selected: true,
          rank: 1,
          defaults: {
            max_chunk_words: 35,
            max_sentences_per_chunk: 1,
          },
        },
      },
    },
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(uploads[0].body.metadata, {
    training: {
      engineVersion: 'v2ProPlus',
      skipDenoise: true,
      batchSize: 2,
      sovitsEpochs: 8,
      gptEpochs: 15,
    },
    reference: {
      mode: 'strict',
      primary: { path: 'training/datasets/metadata/denoised/ref.wav', score: 124 },
      aux: [{ path: 'training/datasets/metadata/denoised/aux.wav', score: 118 }],
    },
    liveFast: {
      configName: 'Default',
      selected: true,
      rank: 1,
      defaults: {
        max_chunk_words: 35,
        max_sentences_per_chunk: 1,
      },
    },
  });
  assert.deepEqual(uploads[0].body.defaults, {
    top_k: 5,
    speed_factor: 1,
    max_chunk_words: 35,
    max_sentences_per_chunk: 1,
  });
  assert.deepEqual(uploads[1].body.metadata, uploads[0].body.metadata);
  assert.deepEqual(uploads[1].body.defaults, uploads[0].body.defaults);
});

test('voice profile activate rejects incomplete profile payloads', async () => {
  const handler = createHandler({
    readObject: async () => {
      throw new Error('not used');
    },
    writeObject: async () => {
      throw new Error('should not write');
    },
    now: () => '2026-05-18T10:00:00.000Z',
  });

  const response = await handler(createEvent({
    method: 'POST',
    path: '/api/voice-profile/activate',
    body: {
      voiceProfileId: 'michael-tan-v1',
      displayName: 'Michael Tan',
      gptKey: 'models/user-models/gpt/michael-tan.ckpt',
      sovitsKey: 'models/user-models/sovits/michael-tan.pth',
    },
  }));

  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).error, /ref_audio_path is required/u);
});

test('voice profile active returns only summary data', async () => {
  const handler = createHandler({
    readObject: async (key) => {
      assert.equal(key, 'voice-profiles/active.json');
      return Buffer.from(JSON.stringify({
        voiceProfileId: 'dr-lim-v1',
        displayName: 'Dr Lim',
        gptKey: 'models/user-models/gpt/dr-lim.ckpt',
        sovitsKey: 'models/user-models/sovits/dr-lim.pth',
        ref_audio_path: 'training/datasets/dr-lim/reference.wav',
        prompt_text: 'Reference transcript',
        prompt_lang: 'en',
        text_lang: 'en',
        preferredRoute: 'sentence',
        aux_ref_audio_paths: [],
        defaults: {
          top_k: 5,
          top_p: 0.85,
          temperature: 0.7,
          repetition_penalty: 1.35,
          speed_factor: 1.0,
        },
        updatedAt: '2026-05-18T10:00:00.000Z',
        activatedAt: '2026-05-18T10:00:00.000Z',
      }), 'utf-8');
    },
    writeObject: async () => {
      throw new Error('not used');
    },
    now: () => '2026-05-18T10:00:00.000Z',
  });

  const response = await handler(createEvent({
    method: 'GET',
    path: '/api/voice-profile/active',
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    voiceProfileId: 'dr-lim-v1',
    displayName: 'Dr Lim',
    activatedAt: '2026-05-18T10:00:00.000Z',
  });
});

test('voice profile active can return the full stored profile for browser restore when full=1 is requested', async () => {
  const handler = createHandler({
    readObject: async (key) => {
      assert.equal(key, 'voice-profiles/active.json');
      return Buffer.from(JSON.stringify({
        voiceProfileId: 'dr-lim-v1',
        displayName: 'Dr Lim',
        gptKey: 'models/user-models/gpt/dr-lim.ckpt',
        sovitsKey: 'models/user-models/sovits/dr-lim.pth',
        ref_audio_path: 'training/datasets/dr-lim/reference.wav',
        prompt_text: 'Reference transcript',
        prompt_lang: 'en',
        text_lang: 'en',
        preferredRoute: 'sentence',
        aux_ref_audio_paths: ['training/datasets/dr-lim/aux-1.wav'],
        defaults: {
          top_k: 5,
          top_p: 0.85,
          temperature: 0.7,
          repetition_penalty: 1.35,
          speed_factor: 1.0,
        },
        updatedAt: '2026-05-18T10:00:00.000Z',
        activatedAt: '2026-05-18T10:00:00.000Z',
      }), 'utf-8');
    },
    writeObject: async () => {
      throw new Error('not used');
    },
    now: () => '2026-05-18T10:00:00.000Z',
  });

  const response = await handler(createEvent({
    method: 'GET',
    path: '/api/voice-profile/active',
    query: { full: '1' },
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    voiceProfileId: 'dr-lim-v1',
    displayName: 'Dr Lim',
    gptKey: 'models/user-models/gpt/dr-lim.ckpt',
    sovitsKey: 'models/user-models/sovits/dr-lim.pth',
    ref_audio_path: 'training/datasets/dr-lim/reference.wav',
    prompt_text: 'Reference transcript',
    prompt_lang: 'en',
    text_lang: 'en',
    preferredRoute: 'sentence',
    aux_ref_audio_paths: ['training/datasets/dr-lim/aux-1.wav'],
    defaults: {
      top_k: 5,
      top_p: 0.85,
      temperature: 0.7,
      repetition_penalty: 1.35,
      speed_factor: 1.0,
    },
    updatedAt: '2026-05-18T10:00:00.000Z',
    activatedAt: '2026-05-18T10:00:00.000Z',
  });
});

test('voice profile active returns 404 when no active profile has been saved', async () => {
  const handler = createHandler({
    readObject: async () => null,
    writeObject: async () => {
      throw new Error('not used');
    },
    now: () => '2026-05-18T10:00:00.000Z',
  });

  const response = await handler(createEvent({
    method: 'GET',
    path: '/api/voice-profile/active',
  }));

  assert.equal(response.statusCode, 404);
  assert.match(JSON.parse(response.body).error, /No active voice profile/u);
});

test('voice profile internal returns the full stored profile when the shared secret matches', async () => {
  const handler = createHandler({
    readObject: async (key) => {
      assert.equal(key, 'voice-profiles/michael-tan-v1.json');
      return Buffer.from(JSON.stringify({
        voiceProfileId: 'michael-tan-v1',
        displayName: 'Michael Tan',
        preferredRoute: 'sentence',
        gptKey: 'models/user-models/gpt/michael-tan.ckpt',
        sovitsKey: 'models/user-models/sovits/michael-tan.pth',
        ref_audio_path: 'training/datasets/michael-tan/reference.wav',
        prompt_text: 'Reference transcript',
        prompt_lang: 'en',
        text_lang: 'en',
        aux_ref_audio_paths: ['training/datasets/michael-tan/aux1.wav'],
        defaults: {
          top_k: 5,
          top_p: 0.85,
          temperature: 0.7,
          repetition_penalty: 1.35,
          speed_factor: 1.0,
        },
        updatedAt: '2026-05-18T10:00:00.000Z',
      }), 'utf-8');
    },
    writeObject: async () => {
      throw new Error('not used');
    },
    internalAuthHeaderName: 'x-internal-key',
    internalAuthHeaderValue: 'super-secret',
    now: () => '2026-05-18T10:00:00.000Z',
  });

  const response = await handler({
    ...createEvent({
      method: 'GET',
      path: '/api/voice-profile/internal/michael-tan-v1',
    }),
    headers: {
      'x-internal-key': 'super-secret',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    voiceProfileId: 'michael-tan-v1',
    displayName: 'Michael Tan',
    preferredRoute: 'sentence',
    gptKey: 'models/user-models/gpt/michael-tan.ckpt',
    sovitsKey: 'models/user-models/sovits/michael-tan.pth',
    ref_audio_path: 'training/datasets/michael-tan/reference.wav',
    prompt_text: 'Reference transcript',
    prompt_lang: 'en',
    text_lang: 'en',
    aux_ref_audio_paths: ['training/datasets/michael-tan/aux1.wav'],
    defaults: {
      top_k: 5,
      top_p: 0.85,
      temperature: 0.7,
      repetition_penalty: 1.35,
      speed_factor: 1.0,
    },
    updatedAt: '2026-05-18T10:00:00.000Z',
  });
});

test('voice profile internal rejects requests with missing or wrong shared secret', async () => {
  const handler = createHandler({
    readObject: async () => {
      throw new Error('not used');
    },
    writeObject: async () => {
      throw new Error('not used');
    },
    internalAuthHeaderName: 'x-internal-key',
    internalAuthHeaderValue: 'super-secret',
    now: () => '2026-05-18T10:00:00.000Z',
  });

  const response = await handler(createEvent({
    method: 'GET',
    path: '/api/voice-profile/internal/michael-tan-v1',
  }));

  assert.equal(response.statusCode, 403);
  assert.match(JSON.parse(response.body).error, /Forbidden/u);
});
