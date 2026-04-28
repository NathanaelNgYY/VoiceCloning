import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

function stripPrefix(key) {
  const prefix = S3_PREFIX ? S3_PREFIX.replace(/\/+$/u, '') + '/' : '';
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function requireBucket() {
  if (!S3_BUCKET) {
    throw new Error('S3_BUCKET env var is not set');
  }
  return S3_BUCKET;
}

export async function generatePresignedPutUrl(key, contentType, expiresIn = 3600) {
  const bucket = requireBucket();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: fullKey(key),
    ContentType: contentType,
  });
  const url = await getSignedUrl(getClient(), command, { expiresIn });
  return { url, key };
}

export async function generatePresignedGetUrl(key, expiresIn = 3600) {
  const bucket = requireBucket();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: fullKey(key),
  });
  return getSignedUrl(getClient(), command, { expiresIn });
}

export async function uploadBuffer(key, buffer, contentType) {
  const bucket = requireBucket();
  await getClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: fullKey(key),
    Body: buffer,
    ContentType: contentType,
  }));
}

export async function headObject(key) {
  const bucket = requireBucket();
  try {
    const response = await getClient().send(new HeadObjectCommand({
      Bucket: bucket,
      Key: fullKey(key),
    }));
    return { size: response.ContentLength, lastModified: response.LastModified };
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

export async function listObjects(prefix) {
  const bucket = requireBucket();
  const results = [];
  let continuationToken;
  do {
    const response = await getClient().send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: fullKey(prefix),
      ContinuationToken: continuationToken,
    }));
    if (response.Contents) {
      for (const object of response.Contents) {
        results.push({
          key: stripPrefix(object.Key),
          size: object.Size,
          lastModified: object.LastModified,
        });
      }
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return results;
}

export async function getObject(key) {
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
