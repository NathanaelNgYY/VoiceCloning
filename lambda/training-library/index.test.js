import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handler,
  __resetTrainingLibraryDepsForTest,
  __setTrainingLibraryDepsForTest,
} from './index.js';

function buildEvent({ method = 'GET', rawPath = '/api/training-library', body } = {}) {
  return {
    requestContext: { http: { method } },
    rawPath,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function createMemoryDeps() {
  const memory = {
    index: [],
    objects: new Map(),
  };

  return {
    memory,
    deps: {
      nowIso: () => '2026-06-05T10:00:00.000Z',
      generateId: () => 'lib-1',
      generatePresignedPutUrl: async (key, contentType) => ({
        url: `https://upload.example/${key}`,
        key,
        contentType,
      }),
      readIndex: async () => structuredClone(memory.index),
      writeIndex: async (nextIndex) => {
        memory.index = structuredClone(nextIndex);
      },
      headObject: async (key) => {
        const object = memory.objects.get(key);
        return object ? { size: object.size, lastModified: new Date('2026-06-05T10:00:00.000Z') } : null;
      },
      deleteObject: async (key) => {
        memory.objects.delete(key);
      },
      copyObject: async (sourceKey, targetKey) => {
        const object = memory.objects.get(sourceKey);
        if (!object) throw new Error(`Missing source object: ${sourceKey}`);
        memory.objects.set(targetKey, { ...object });
      },
    },
  };
}

test('training library returns an empty list when no entries exist', async () => {
  const { deps } = createMemoryDeps();
  __setTrainingLibraryDepsForTest(deps);

  try {
    const response = await handler(buildEvent());
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { files: [] });
  } finally {
    __resetTrainingLibraryDepsForTest();
  }
});

test('training library confirm creates a new library entry after upload', async () => {
  const { deps, memory } = createMemoryDeps();
  __setTrainingLibraryDepsForTest(deps);

  try {
    const presignResponse = await handler(buildEvent({
      method: 'POST',
      rawPath: '/api/training-library/presign',
      body: { filename: 'lecture.wav', type: 'audio/wav' },
    }));
    assert.equal(presignResponse.statusCode, 200);

    const presignBody = JSON.parse(presignResponse.body);
    memory.objects.set(presignBody.key, { size: 4096, contentType: 'audio/wav' });

    const confirmResponse = await handler(buildEvent({
      method: 'POST',
      rawPath: '/api/training-library/confirm',
      body: {
        id: presignBody.id,
        key: presignBody.key,
        filename: presignBody.filename,
        contentType: 'audio/wav',
      },
    }));

    assert.equal(confirmResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(confirmResponse.body).file, {
      id: 'lib-1',
      filename: 'lecture.wav',
      s3Key: presignBody.key,
      contentType: 'audio/wav',
      size: 4096,
      createdAt: '2026-06-05T10:00:00.000Z',
      updatedAt: '2026-06-05T10:00:00.000Z',
    });
  } finally {
    __resetTrainingLibraryDepsForTest();
  }
});

test('training library replace-confirm updates the existing entry and removes the old object', async () => {
  const { deps, memory } = createMemoryDeps();
  memory.index = [{
    id: 'lib-1',
    filename: 'lecture.wav',
    s3Key: 'training/library/files/lib-1/audio.wav',
    contentType: 'audio/wav',
    size: 4096,
    createdAt: '2026-06-05T10:00:00.000Z',
    updatedAt: '2026-06-05T10:00:00.000Z',
  }];
  memory.objects.set('training/library/files/lib-1/audio.wav', { size: 4096, contentType: 'audio/wav' });
  memory.objects.set('training/library/files/lib-1/audio.mp3', { size: 2048, contentType: 'audio/mpeg' });

  __setTrainingLibraryDepsForTest(deps);

  try {
    const response = await handler(buildEvent({
      method: 'POST',
      rawPath: '/api/training-library/lib-1/replace-confirm',
      body: {
        key: 'training/library/files/lib-1/audio.mp3',
        filename: 'lecture-updated.mp3',
        contentType: 'audio/mpeg',
      },
    }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body).file, {
      id: 'lib-1',
      filename: 'lecture-updated.mp3',
      s3Key: 'training/library/files/lib-1/audio.mp3',
      contentType: 'audio/mpeg',
      size: 2048,
      createdAt: '2026-06-05T10:00:00.000Z',
      updatedAt: '2026-06-05T10:00:00.000Z',
    });
    assert.equal(memory.objects.has('training/library/files/lib-1/audio.wav'), false);
  } finally {
    __resetTrainingLibraryDepsForTest();
  }
});

test('training library delete removes the entry and its object', async () => {
  const { deps, memory } = createMemoryDeps();
  memory.index = [{
    id: 'lib-1',
    filename: 'lecture.wav',
    s3Key: 'training/library/files/lib-1/audio.wav',
    contentType: 'audio/wav',
    size: 4096,
    createdAt: '2026-06-05T10:00:00.000Z',
    updatedAt: '2026-06-05T10:00:00.000Z',
  }];
  memory.objects.set('training/library/files/lib-1/audio.wav', { size: 4096, contentType: 'audio/wav' });

  __setTrainingLibraryDepsForTest(deps);

  try {
    const response = await handler(buildEvent({
      method: 'DELETE',
      rawPath: '/api/training-library/lib-1',
    }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { deleted: true, id: 'lib-1' });
    assert.deepEqual(memory.index, []);
    assert.equal(memory.objects.has('training/library/files/lib-1/audio.wav'), false);
  } finally {
    __resetTrainingLibraryDepsForTest();
  }
});

test('training library snapshot copies selected shared files into the experiment raw prefix', async () => {
  const { deps, memory } = createMemoryDeps();
  memory.index = [
    {
      id: 'lib-1',
      filename: 'lecture.wav',
      s3Key: 'training/library/files/lib-1/audio.wav',
      contentType: 'audio/wav',
      size: 4096,
      createdAt: '2026-06-05T10:00:00.000Z',
      updatedAt: '2026-06-05T10:00:00.000Z',
    },
    {
      id: 'lib-2',
      filename: 'lecture.wav',
      s3Key: 'training/library/files/lib-2/audio.wav',
      contentType: 'audio/wav',
      size: 2048,
      createdAt: '2026-06-05T10:00:00.000Z',
      updatedAt: '2026-06-05T10:00:00.000Z',
    },
  ];
  memory.objects.set('training/library/files/lib-1/audio.wav', { size: 4096, contentType: 'audio/wav' });
  memory.objects.set('training/library/files/lib-2/audio.wav', { size: 2048, contentType: 'audio/wav' });

  __setTrainingLibraryDepsForTest(deps);

  try {
    const response = await handler(buildEvent({
      method: 'POST',
      rawPath: '/api/training-library/snapshot',
      body: {
        expName: 'demo-voice',
        fileIds: ['lib-1', 'lib-2'],
      },
    }));

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      copied: 2,
      files: [
        'training/datasets/demo-voice/raw/lecture.wav',
        'training/datasets/demo-voice/raw/lecture_2.wav',
      ],
    });
    assert.equal(memory.objects.has('training/datasets/demo-voice/raw/lecture.wav'), true);
    assert.equal(memory.objects.has('training/datasets/demo-voice/raw/lecture_2.wav'), true);
  } finally {
    __resetTrainingLibraryDepsForTest();
  }
});
