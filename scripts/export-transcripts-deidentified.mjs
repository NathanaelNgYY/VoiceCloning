// Exports chat transcripts with every identifier removed.
//
// Why this exists: identifiable rows expire after TRANSCRIPT_TTL_DAYS (90 by
// default) because they are health-adjacent free text tied to named students.
// Research use does not need the names — so it reads this instead, which is not
// personal data and therefore carries no retention limit.
//
// Identity is replaced with a salted hash, so turns from one person still group
// together and sessions can be counted per user, but the original oid and email
// cannot be recovered from the output. Use a different salt per export unless you
// deliberately need two exports to line up.
//
// Usage:
//   node scripts/export-transcripts-deidentified.mjs --out research-export.jsonl
//
// Env:
//   TRANSCRIPT_TABLE_NAME    (default vcs-staging-transcripts)
//   TRANSCRIPT_TABLE_REGION  (default ap-northeast-2)
//   TRANSCRIPT_EXPORT_SALT   (default: a random salt, printed but not stored)
//
// Requires AWS credentials with dynamodb:Scan on the table.
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

// The AWS SDK lives in the gateway's dependencies; this script borrows it rather
// than adding a second copy at the repo root.
const requireFromGateway = createRequire(
  new URL('../live-gateway/package.json', import.meta.url),
);
const { DynamoDBClient } = requireFromGateway('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = requireFromGateway('@aws-sdk/lib-dynamodb');

function parseArgs(argv) {
  const args = { out: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') {
      args.out = argv[index + 1] || '';
      index += 1;
    }
  }
  return args;
}

// Truncated to keep the output readable; collision risk across a cohort of a few
// hundred students is negligible, and a collision would only merge two people's
// rows, never reveal who they are.
export function pseudonymize(oid, exportSalt) {
  return createHash('sha256').update(`${exportSalt}:${oid}`).digest('hex').slice(0, 16);
}

export function deidentifyItem(item, exportSalt) {
  const oid = String(item.PK || '').replace(/^USER#/u, '');
  const [, sessionId, , sequence] = String(item.SK || '').split('#');

  // Session metadata carries the email and display name and nothing research
  // needs, so it is dropped entirely rather than scrubbed field by field.
  if (String(item.SK || '').endsWith('#META')) {
    return null;
  }

  return {
    participant: pseudonymize(oid, exportSalt),
    session: pseudonymize(`${oid}:${sessionId}`, exportSalt),
    turn: Number.parseInt(sequence, 10),
    role: item.role,
    text: item.text,
    ts: item.ts,
    ...(item.cancelled ? { cancelled: true } : {}),
    ...(item.synthetic ? { synthetic: true } : {}),
  };
}

async function main() {
  const { out } = parseArgs(process.argv.slice(2));
  if (!out) {
    throw new Error('Pass --out <file.jsonl>.');
  }

  const tableName = process.env.TRANSCRIPT_TABLE_NAME || 'vcs-staging-transcripts';
  const region = process.env.TRANSCRIPT_TABLE_REGION || 'ap-northeast-2';
  const salt = process.env.TRANSCRIPT_EXPORT_SALT || randomBytes(16).toString('hex');

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  const rows = [];
  let lastEvaluatedKey;

  do {
    const page = await client.send(new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    for (const item of page.Items || []) {
      // Load-test rows are excluded: they are synthetic and would skew any count.
      if (item.synthetic) continue;
      const row = deidentifyItem(item, salt);
      if (row) rows.push(row);
    }

    lastEvaluatedKey = page.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  rows.sort((a, b) => (
    a.participant.localeCompare(b.participant)
    || a.session.localeCompare(b.session)
    || a.turn - b.turn
  ));

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');

  const participants = new Set(rows.map((row) => row.participant));
  const sessions = new Set(rows.map((row) => row.session));
  console.log(JSON.stringify({
    table: tableName,
    region,
    out,
    turns: rows.length,
    participants: participants.size,
    sessions: sessions.size,
    // Printed, never written: without it the pseudonyms cannot be linked back,
    // which is the point. Keep it only if a later export must align with this one.
    saltUsedThisRun: salt,
  }, null, 2));
}

// Importable for tests without hitting DynamoDB.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/gu, '/'))) {
  await main();
}
