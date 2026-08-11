import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';

const requireFromLambda = createRequire(new URL('../lambda/package.json', import.meta.url));
const {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} = requireFromLambda('@aws-sdk/client-s3');

const bucket = process.argv[2];
const rootPrefix = String(process.argv[3] || '').replace(/^\/+|\/+$/gu, '');
const region = process.argv[4] || 'ap-southeast-1';
if (!bucket || !rootPrefix) {
  throw new Error('Usage: node scripts/backfill-analytics-user-index.mjs <bucket> <root-prefix> [region]');
}

const client = new S3Client({ region });
const sourcePrefix = `${rootPrefix}/analytics/events/`;
let continuationToken;
let legacyBatches = 0;
let indexedCopies = 0;
let skipped = 0;

do {
  const listed = await client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: sourcePrefix,
    ContinuationToken: continuationToken,
  }));
  for (const object of listed.Contents || []) {
    legacyBatches += 1;
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
    const compressed = Buffer.from(await response.Body.transformToByteArray());
    let record;
    try {
      record = JSON.parse(gunzipSync(compressed).toString('utf8'));
    } catch {
      skipped += 1;
      continue;
    }
    const oid = String(record?.subject?.oid || '');
    if (!/^[A-Za-z0-9-]+$/u.test(oid)) {
      skipped += 1;
      continue;
    }
    const relativeKey = object.Key.slice(sourcePrefix.length);
    await client.send(new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${object.Key}`,
      Key: `${rootPrefix}/analytics/users/${oid}/${relativeKey}`,
      MetadataDirective: 'COPY',
    }));
    indexedCopies += 1;
  }
  continuationToken = listed.NextContinuationToken;
} while (continuationToken);

process.stdout.write(JSON.stringify({ legacyBatches, indexedCopies, skipped }) + '\n');
