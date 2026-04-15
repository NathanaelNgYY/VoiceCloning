import fs from 'fs';
import path from 'path';
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { S3_BUCKET, S3_REGION, S3_PREFIX } from '../config.js';

let client = null;

function getClient() {
  if (!client) {
    client = new S3Client({ region: S3_REGION });
  }
  return client;
}

function fullKey(key) {
  const prefix = S3_PREFIX ? S3_PREFIX.replace(/\/+$/, '') + '/' : '';
  return prefix + key;
}

function stripPrefix(key) {
  const prefix = S3_PREFIX ? S3_PREFIX.replace(/\/+$/, '') + '/' : '';
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export async function downloadPrefix(s3Prefix, localDir) {
  fs.mkdirSync(localDir, { recursive: true });

  let continuationToken;
  let count = 0;
  do {
    const response = await getClient().send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: fullKey(s3Prefix),
      ContinuationToken: continuationToken,
    }));

    if (response.Contents) {
      for (const obj of response.Contents) {
        const relativeKey = stripPrefix(obj.Key);
        const relativePath = relativeKey.slice(s3Prefix.length);
        if (!relativePath || relativePath.endsWith('/')) continue;

        const localPath = path.join(localDir, relativePath);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });

        const getRes = await getClient().send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: obj.Key,
        }));

        const chunks = [];
        for await (const chunk of getRes.Body) {
          chunks.push(chunk);
        }
        fs.writeFileSync(localPath, Buffer.concat(chunks));
        count += 1;
      }
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return count;
}

export async function uploadDirectory(localDir, s3Prefix) {
  if (!fs.existsSync(localDir)) return 0;

  let count = 0;
  const entries = fs.readdirSync(localDir, { withFileTypes: true });

  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    if (entry.isDirectory()) {
      count += await uploadDirectory(localPath, `${s3Prefix}${entry.name}/`);
    } else {
      const fileBuffer = fs.readFileSync(localPath);
      const key = `${s3Prefix}${entry.name}`;
      await getClient().send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: fullKey(key),
        Body: fileBuffer,
      }));
      count += 1;
    }
  }

  return count;
}

export async function uploadFile(localPath, s3Key) {
  const fileBuffer = fs.readFileSync(localPath);
  await getClient().send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: fullKey(s3Key),
    Body: fileBuffer,
  }));
}

export async function downloadFile(s3Key, localPath) {
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const response = await getClient().send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: fullKey(s3Key),
  }));
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  fs.writeFileSync(localPath, Buffer.concat(chunks));
}
