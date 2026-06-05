import crypto from 'node:crypto';
import path from 'node:path';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { isSafePathSegment, sanitizeFilename } from '../shared/paths.js';
import { ok, err, preflight, parseJsonBody } from '../shared/cors.js';

const ALLOWED_AUDIO_EXTS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.webm', '.mp4']);
const INDEX_KEY = 'training/library/index.json';
const FILES_PREFIX = 'training/library/files';
const S3_REGION = process.env.S3_REGION || 'us-east-1';
const S3_BUCKET = process.env.S3_BUCKET || '';
const S3_PREFIX = process.env.S3_PREFIX || '';

let client = null;

function getClient() {
  if (!client) {
    client = new S3Client({ region: S3_REGION });
  }
  return client;
}

function fullKey(key) {
  const prefix = S3_PREFIX ? S3_PREFIX.replace(/\/+$/u, '') + '/' : '';
  return prefix + key;
}

function requireBucket() {
  if (!S3_BUCKET) {
    throw new Error('S3_BUCKET env var is not set');
  }
  return S3_BUCKET;
}

function isNotFoundError(error) {
  return error?.name === 'NoSuchKey'
    || error?.name === 'NotFound'
    || error?.$metadata?.httpStatusCode === 404;
}

async function generatePresignedPutUrl(key, contentType, expiresIn = 3600) {
  const bucket = requireBucket();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: fullKey(key),
    ContentType: contentType,
  });
  const url = await getSignedUrl(getClient(), command, { expiresIn });
  return { url, key };
}

async function getObject(key) {
  const bucket = requireBucket();
  const response = await getClient().send(new GetObjectCommand({
    Bucket: bucket,
    Key: fullKey(key),
  }));
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function uploadBuffer(key, buffer, contentType) {
  const bucket = requireBucket();
  await getClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: fullKey(key),
    Body: buffer,
    ContentType: contentType,
  }));
}

async function headObject(key) {
  const bucket = requireBucket();
  try {
    const response = await getClient().send(new HeadObjectCommand({
      Bucket: bucket,
      Key: fullKey(key),
    }));
    return {
      size: Number(response.ContentLength || 0),
      lastModified: response.LastModified || new Date(),
      contentType: response.ContentType || 'application/octet-stream',
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function deleteObject(key) {
  const bucket = requireBucket();
  await getClient().send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: fullKey(key),
  }));
}

async function copyObject(sourceKey, targetKey) {
  const bucket = requireBucket();
  await getClient().send(new CopyObjectCommand({
    Bucket: bucket,
    CopySource: `${bucket}/${fullKey(sourceKey)}`,
    Key: fullKey(targetKey),
  }));
}

async function readIndex() {
  try {
    const buffer = await getObject(INDEX_KEY);
    const parsed = JSON.parse(buffer.toString('utf-8'));
    return Array.isArray(parsed?.files) ? parsed.files : [];
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

async function writeIndex(files) {
  await uploadBuffer(
    INDEX_KEY,
    Buffer.from(JSON.stringify({ files }, null, 2)),
    'application/json',
  );
}

function sortFiles(files) {
  return [...files].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function ensureAudioExtension(filename = '') {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_AUDIO_EXTS.has(ext)) {
    throw new Error(`Unsupported audio file extension "${ext || '(none)'}"`);
  }
  return ext;
}

function buildLibraryObjectKey(id, ext) {
  return `${FILES_PREFIX}/${id}/audio${ext}`;
}

function replaceFileEntry(files, nextFile) {
  return files.map((file) => (file.id === nextFile.id ? nextFile : file));
}

function uniqueSnapshotKeys(expName, files) {
  const seen = new Map();
  return files.map((file) => {
    const safeName = sanitizeFilename(file.filename, 'training-library-audio');
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    const count = (seen.get(safeName) || 0) + 1;
    seen.set(safeName, count);
    const filename = count === 1 ? safeName : `${base}_${count}${ext}`;
    return `training/datasets/${expName}/raw/${filename}`;
  });
}

const defaultDeps = {
  nowIso: () => new Date().toISOString(),
  generateId: () => crypto.randomUUID(),
  generatePresignedPutUrl,
  readIndex,
  writeIndex,
  headObject,
  deleteObject,
  copyObject,
};

let deps = defaultDeps;

export function __setTrainingLibraryDepsForTest(overrides) {
  deps = { ...defaultDeps, ...overrides };
}

export function __resetTrainingLibraryDepsForTest() {
  deps = defaultDeps;
}

function extractFileId(routePath = '') {
  const segments = routePath.split('/').filter(Boolean);
  return segments[2] || '';
}

export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return preflight(event);
  }

  const method = event.requestContext?.http?.method || 'GET';
  const routePath = event.rawPath || '';
  let body = {};

  if (method === 'POST') {
    try {
      body = parseJsonBody(event);
    } catch {
      return err(400, 'Invalid JSON body', event);
    }
  }

  try {
    if (method === 'GET' && /\/api\/training-library\/?$/u.test(routePath)) {
      const files = sortFiles(await deps.readIndex());
      return ok({ files }, {}, event);
    }

    if (method === 'POST' && routePath.endsWith('/training-library/presign')) {
      const safeName = sanitizeFilename(body.filename, 'training-library-audio');
      const ext = ensureAudioExtension(safeName);
      const id = String(deps.generateId());
      const key = buildLibraryObjectKey(id, ext);
      const { url } = await deps.generatePresignedPutUrl(key, body.type || 'audio/wav');
      return ok({ id, filename: safeName, key, url }, {}, event);
    }

    if (method === 'POST' && routePath.endsWith('/training-library/confirm')) {
      const id = String(body.id || '').trim();
      if (!id) return err(400, 'id is required', event);
      const files = await deps.readIndex();
      if (files.some((file) => file.id === id)) {
        return err(409, 'A shared storage file with this id already exists', event);
      }

      const safeName = sanitizeFilename(body.filename, 'training-library-audio');
      const ext = ensureAudioExtension(safeName);
      const key = String(body.key || '').trim();
      if (key !== buildLibraryObjectKey(id, ext)) {
        return err(400, 'key does not match the uploaded file id', event);
      }

      const uploaded = await deps.headObject(key);
      if (!uploaded) {
        return err(404, 'Uploaded file was not found in S3', event);
      }

      const nowIso = deps.nowIso();
      const file = {
        id,
        filename: safeName,
        s3Key: key,
        contentType: String(body.contentType || uploaded.contentType || 'audio/wav'),
        size: Number(uploaded.size || 0),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await deps.writeIndex(sortFiles([...files, file]));
      return ok({ file }, {}, event);
    }

    if (method === 'POST' && routePath.endsWith('/training-library/snapshot')) {
      const expName = String(body.expName || '').trim();
      if (!expName) return err(400, 'expName is required', event);
      if (!isSafePathSegment(expName)) {
        return err(400, 'expName may only contain letters, numbers, dots, dashes, and underscores', event);
      }

      const fileIds = Array.isArray(body.fileIds)
        ? body.fileIds.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
      if (fileIds.length === 0) {
        return err(400, 'fileIds array is required', event);
      }

      const files = await deps.readIndex();
      const selectedFiles = fileIds.map((id) => files.find((file) => file.id === id) || null);
      if (selectedFiles.some((file) => file === null)) {
        return err(404, 'One or more shared storage files were removed before training started.', event);
      }

      const targetKeys = uniqueSnapshotKeys(expName, selectedFiles);
      for (let index = 0; index < selectedFiles.length; index += 1) {
        await deps.copyObject(selectedFiles[index].s3Key, targetKeys[index]);
      }

      return ok({ copied: selectedFiles.length, files: targetKeys }, {}, event);
    }

    if (method === 'POST' && routePath.endsWith('/replace-presign')) {
      const fileId = extractFileId(routePath);
      const files = await deps.readIndex();
      const existingFile = files.find((file) => file.id === fileId);
      if (!existingFile) return err(404, 'Shared storage file not found', event);

      const safeName = sanitizeFilename(body.filename, 'training-library-audio');
      const ext = ensureAudioExtension(safeName);
      const key = buildLibraryObjectKey(fileId, ext);
      const { url } = await deps.generatePresignedPutUrl(key, body.type || existingFile.contentType || 'audio/wav');
      return ok({ id: fileId, filename: safeName, key, url }, {}, event);
    }

    if (method === 'POST' && routePath.endsWith('/replace-confirm')) {
      const fileId = extractFileId(routePath);
      const files = await deps.readIndex();
      const existingFile = files.find((file) => file.id === fileId);
      if (!existingFile) return err(404, 'Shared storage file not found', event);

      const safeName = sanitizeFilename(body.filename, 'training-library-audio');
      const ext = ensureAudioExtension(safeName);
      const key = String(body.key || '').trim();
      if (key !== buildLibraryObjectKey(fileId, ext)) {
        return err(400, 'key does not match the shared storage file id', event);
      }

      const uploaded = await deps.headObject(key);
      if (!uploaded) {
        return err(404, 'Replacement file was not found in S3', event);
      }

      if (existingFile.s3Key && existingFile.s3Key !== key) {
        await deps.deleteObject(existingFile.s3Key);
      }

      const file = {
        ...existingFile,
        filename: safeName,
        s3Key: key,
        contentType: String(body.contentType || uploaded.contentType || existingFile.contentType || 'audio/wav'),
        size: Number(uploaded.size || 0),
        updatedAt: deps.nowIso(),
      };
      await deps.writeIndex(sortFiles(replaceFileEntry(files, file)));
      return ok({ file }, {}, event);
    }

    if (method === 'DELETE' && /^\/api\/training-library\/[^/]+\/?$/u.test(routePath)) {
      const fileId = extractFileId(routePath);
      const files = await deps.readIndex();
      const existingFile = files.find((file) => file.id === fileId);
      if (!existingFile) return err(404, 'Shared storage file not found', event);

      await deps.deleteObject(existingFile.s3Key);
      await deps.writeIndex(sortFiles(files.filter((file) => file.id !== fileId)));
      return ok({ deleted: true, id: fileId }, {}, event);
    }

    return err(404, 'Not found', event);
  } catch (error) {
    return err(500, error.message || 'Unexpected error', event);
  }
};
