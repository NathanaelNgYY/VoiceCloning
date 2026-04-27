import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3_BUCKET, S3_REGION, S3_PREFIX } from '../config.js';

let client = null;

function getClient() {
  if (!client) {
    if (!S3_REGION) {
      throw new Error('S3_REGION is not configured');
    }
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
    throw new Error('S3_BUCKET is not configured');
  }
  return S3_BUCKET;
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

export async function headObject(key) {
  const bucket = requireBucket();
  try {
    const response = await getClient().send(new HeadObjectCommand({
      Bucket: bucket,
      Key: fullKey(key),
    }));
    return { size: response.ContentLength, lastModified: response.LastModified };
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
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
      for (const obj of response.Contents) {
        results.push({
          key: stripPrefix(obj.Key),
          size: obj.Size,
          lastModified: obj.LastModified,
        });
      }
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return results;
}

export async function generatePresignedGetUrl(key, expiresIn = 3600) {
  const bucket = requireBucket();
  const command = new GetObjectCommand({ Bucket: bucket, Key: fullKey(key) });
  return getSignedUrl(getClient(), command, { expiresIn });
}
