#!/usr/bin/env node
// Renders the transcript table as user -> visit -> session -> turns.
//
// Why this exists: the DynamoDB console can only Scan, which interleaves every
// row of every person with no hierarchy, so a handful of conversations looks
// like chaos. The data is fine; the view was the problem. Nothing here writes.
//
// Run it with YOUR credentials, not the gateway's. `VoiClo_GPU` holds PutItem
// and nothing else — it cannot read the table, deliberately, and this script
// would fail there.
//
//   node scripts/read-transcripts.mjs                     # everyone, one line each
//   node scripts/read-transcripts.mjs --user <oid|email>  # one person, in full
//   node scripts/read-transcripts.mjs --day 2026-08-06    # who signed in that day
//   node scripts/read-transcripts.mjs --user x --no-turns # structure without content
//
// Prints student names, emails and everything they typed. Treat the output as
// you would the table itself: don't paste it anywhere it doesn't belong.
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.TRANSCRIPT_TABLE_NAME || 'vcs-staging-transcripts';
const REGION = process.env.TRANSCRIPT_TABLE_REGION || 'ap-northeast-2';
const SIGNIN_INDEX = 'signins-by-day';

const SESSION_PREFIX = 'SESSION#';
const SIGNIN_PREFIX = 'SIGNIN#';
const META_SUFFIX = '#META';
const TURN_MARKER = '#TURN#';

function parseArgs(argv) {
  const args = { turns: true };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--no-turns') args.turns = false;
    else if (flag === '--user') args.user = argv[++i];
    else if (flag === '--day') args.day = argv[++i];
    else if (flag === '--table') args.table = argv[++i];
    else if (flag === '--region') args.region = argv[++i];
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

/**
 * Splits a session sort key back into its parts.
 *
 * Deliberately parses from the right. Session ids used to be bare UUIDs and are
 * now `<iso>#<short>`, which contains a `#` of its own — splitting from the left
 * would mangle every row written after that change, and both formats coexist
 * until the older ones reach their TTL.
 */
export function parseSessionKey(sortKey) {
  if (typeof sortKey !== 'string' || !sortKey.startsWith(SESSION_PREFIX)) return null;
  const rest = sortKey.slice(SESSION_PREFIX.length);

  if (rest.endsWith(META_SUFFIX)) {
    return { sessionId: rest.slice(0, -META_SUFFIX.length), kind: 'meta' };
  }

  const turnAt = rest.lastIndexOf(TURN_MARKER);
  if (turnAt !== -1) {
    return {
      sessionId: rest.slice(0, turnAt),
      kind: 'turn',
      sequence: Number(rest.slice(turnAt + TURN_MARKER.length)),
    };
  }
  return null;
}

/**
 * When a session began, best-effort. The META row is authoritative but is only
 * written once a student actually says something; a time-ordered session id
 * carries the socket-open time; and a bare UUID carries nothing at all, which
 * is the whole reason session keys changed.
 */
export function sessionStartedAt(session) {
  if (session.startedAt) return session.startedAt;
  const [maybeIso] = session.sessionId.split('#');
  if (/^\d{4}-\d{2}-\d{2}T/u.test(maybeIso)) return maybeIso;
  return session.turns[0]?.ts || '';
}

/**
 * Attaches each session to the visit it happened during: the latest sign-in at
 * or before the session started.
 *
 * Done here rather than stored on the row, because the gateway does not know
 * the sign-in time when a socket opens — it would have to keep per-user state
 * in memory, which dies on restart and is wrong the moment there are two
 * gateway instances. Deriving it costs nothing and works on old rows too.
 */
export function groupSessionsIntoVisits(signIns, sessions) {
  const visits = signIns
    .map((signIn) => ({ signedInAt: signIn.signedInAt, sessions: [] }))
    .sort((a, b) => a.signedInAt.localeCompare(b.signedInAt));
  // Sessions that predate every sign-in, or arrived when the endpoint failed.
  const orphans = [];

  for (const session of sessions) {
    const startedAt = sessionStartedAt(session);
    let visit;
    for (const candidate of visits) {
      if (candidate.signedInAt <= startedAt) visit = candidate;
      else break;
    }
    (visit ? visit.sessions : orphans).push(session);
  }

  for (const visit of visits) {
    visit.sessions.sort((a, b) => sessionStartedAt(a).localeCompare(sessionStartedAt(b)));
  }
  return { visits, orphans };
}

/** Folds one user's raw rows into { profile, signIns, sessions }. */
export function shapeUserRows(rows) {
  const profile = rows.find((row) => row.SK === 'PROFILE') || null;
  const signIns = rows.filter((row) => row.SK.startsWith(SIGNIN_PREFIX));
  const sessionsById = new Map();

  const sessionFor = (sessionId) => {
    if (!sessionsById.has(sessionId)) {
      sessionsById.set(sessionId, { sessionId, startedAt: '', lessonSlug: '', turns: [] });
    }
    return sessionsById.get(sessionId);
  };

  for (const row of rows) {
    const parsed = parseSessionKey(row.SK);
    if (!parsed) continue;
    const session = sessionFor(parsed.sessionId);
    if (parsed.kind === 'meta') {
      session.startedAt = row.startedAt || '';
      session.lessonSlug = row.lessonSlug || '';
    } else {
      session.turns.push({ sequence: parsed.sequence, role: row.role, text: row.text, ts: row.ts });
    }
  }

  for (const session of sessionsById.values()) {
    session.turns.sort((a, b) => a.sequence - b.sequence);
  }
  // Sorted here rather than relying on DynamoDB's order, so the pre-existing
  // UUID-keyed sessions come out chronologically too.
  const sessions = [...sessionsById.values()]
    .sort((a, b) => sessionStartedAt(a).localeCompare(sessionStartedAt(b)));

  return { profile, signIns, sessions };
}

const local = (iso) => (iso
  ? new Date(iso).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', hour12: false })
  : '—');

function printUser(rows, { turns = true } = {}) {
  const { profile, signIns, sessions } = shapeUserRows(rows);
  const who = profile
    ? `${profile.displayName || '(no name)'}  <${profile.email || 'no email'}>`
    : '(no profile row)';

  console.log(`\n${who}`);
  console.log(`  oid        ${(profile?.PK || rows[0]?.PK || '').replace('USER#', '')}`);
  console.log(`  last seen  ${local(profile?.lastSeenAt)} SGT`);
  console.log(`  visits ${signIns.length}   sessions ${sessions.length}   `
    + `turns ${sessions.reduce((n, s) => n + s.turns.length, 0)}`);

  const { visits, orphans } = groupSessionsIntoVisits(signIns, sessions);

  for (const visit of visits) {
    console.log(`\n  visit  ${local(visit.signedInAt)} SGT`);
    printSessions(visit.sessions, turns);
  }
  if (orphans.length) {
    // Every session here belongs to a visit whose SIGNIN# row is missing —
    // either it predates the sign-in endpoint, or that call failed. Expected
    // for older rows; a growing count on fresh data is worth investigating.
    console.log('\n  sessions with no matching sign-in');
    printSessions(orphans, turns);
  }
  if (!visits.length && !orphans.length) console.log('\n  no sessions');
}

function printSessions(sessions, turns) {
  for (const session of sessions) {
    const started = local(sessionStartedAt(session));
    const lesson = session.lessonSlug ? `  [${session.lessonSlug}]` : '';
    console.log(`    session  ${started} SGT  (${session.turns.length} turns)${lesson}`);
    if (!turns) continue;
    for (const turn of session.turns) {
      const text = turn.text.length > 100 ? `${turn.text.slice(0, 100)}…` : turn.text;
      console.log(`      ${String(turn.role).padEnd(9)} ${text}`);
    }
  }
}

async function pageAll(doc, Command, params) {
  const items = [];
  let startKey;
  do {
    const page = await doc.send(new Command({ ...params, ExclusiveStartKey: startKey }));
    items.push(...(page.Items || []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`
  read-transcripts — renders the table as user -> visit -> session -> turns

    --user <oid|email>   one person, in full
    --day  <YYYY-MM-DD>  who signed in that UTC day (uses the ${SIGNIN_INDEX} index)
    --no-turns           structure only, no transcript content
    --table / --region   override ${TABLE} / ${REGION}

  Read-only, and needs your credentials — the gateway role cannot read.
`);
    return;
  }

  const table = args.table || TABLE;
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: args.region || REGION }));

  if (args.day) {
    // One Query against the sparse index, rather than scanning every turn row
    // in the table to find the handful that are sign-ins.
    const items = await pageAll(doc, QueryCommand, {
      TableName: table,
      IndexName: SIGNIN_INDEX,
      KeyConditionExpression: 'signInDay = :d',
      ExpressionAttributeValues: { ':d': args.day },
    });
    console.log(`\nsign-ins on ${args.day} (UTC day) — ${items.length}\n`);
    for (const item of items) {
      console.log(`  ${local(item.signedInAt)} SGT  ${item.displayName || '(no name)'}`
        + `  <${item.email || 'no email'}>`);
    }
    const people = new Set(items.map((item) => item.PK));
    console.log(`\n  ${items.length} sign-ins by ${people.size} distinct people`);
    return;
  }

  if (args.user) {
    let partition = args.user.startsWith('USER#') ? args.user : `USER#${args.user}`;
    if (args.user.includes('@')) {
      const found = await pageAll(doc, ScanCommand, {
        TableName: table,
        FilterExpression: 'SK = :p AND email = :e',
        ExpressionAttributeValues: { ':p': 'PROFILE', ':e': args.user.toLowerCase() },
      });
      if (!found.length) throw new Error(`No user with email ${args.user}`);
      partition = found[0].PK;
    }
    const rows = await pageAll(doc, QueryCommand, {
      TableName: table,
      KeyConditionExpression: 'PK = :u',
      ExpressionAttributeValues: { ':u': partition },
    });
    if (!rows.length) throw new Error(`No rows for ${partition}`);
    printUser(rows, { turns: args.turns });
    return;
  }

  const profiles = await pageAll(doc, ScanCommand, {
    TableName: table,
    FilterExpression: 'SK = :p',
    ExpressionAttributeValues: { ':p': 'PROFILE' },
  });
  profiles.sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''));

  console.log(`\n${profiles.length} people in ${table}\n`);
  for (const profile of profiles) {
    console.log(`  ${local(profile.lastSeenAt)} SGT  ${(profile.displayName || '(no name)').padEnd(24)}`
      + `  <${profile.email || 'no email'}>`);
  }
  console.log('\n  --user <oid|email> for one person in full\n');
}

// Guarded so the pure helpers above can be imported by tests without the CLI
// firing and without needing credentials.
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`\n${error.message}\n`);
    process.exitCode = 1;
  });
}
