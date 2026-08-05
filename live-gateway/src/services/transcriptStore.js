// Builds and writes per-turn transcript records.
//
// Deliberately free of the AWS SDK: it takes a `putItem` function, so the item
// shape and key layout can be tested without a client, a table, or credentials.
// `dynamoTranscriptClient.js` supplies the real implementation.
//
// Rule that outranks everything here: a storage failure must never break a
// conversation. Every write is fire-and-forget and every error is swallowed
// after logging. A student mid-question should not lose their session because
// DynamoDB had a bad second.
import { randomUUID } from 'node:crypto';

// Zero-padded so turns sort correctly under DynamoDB's lexicographic range key.
const TURN_SEQUENCE_WIDTH = 6;
const SECONDS_PER_DAY = 86_400;

export function userPartitionKey(oid) {
  return `USER#${oid}`;
}

// One row per person, under the same partition as their sessions, so a single
// Query on PK returns who they are and everything they said. Sorts before every
// SESSION# key, which keeps the profile first in that result.
export const USER_PROFILE_KEY = 'PROFILE';

export function sessionMetaKey(sessionId) {
  return `SESSION#${sessionId}#META`;
}

export function turnSortKey(sessionId, sequence) {
  return `SESSION#${sessionId}#TURN#${String(sequence).padStart(TURN_SEQUENCE_WIDTH, '0')}`;
}

/**
 * @param {object} options
 * @param {(item: object) => Promise<unknown>} options.putItem
 * @param {number} [options.ttlDays]  0 keeps items indefinitely (no ttl attribute).
 * @param {boolean} [options.storeSynthetic]  Whether load-test sessions are written.
 * @param {boolean} [options.storeAssistantTurns]  Whether replies are kept, not just questions.
 */
export function createTranscriptStore({
  putItem,
  ttlDays = 0,
  storeSynthetic = false,
  storeAssistantTurns = false,
  now = () => Date.now(),
  newSessionId = () => randomUUID(),
  logger = console,
}) {
  if (typeof putItem !== 'function') {
    throw new Error('createTranscriptStore requires a putItem function.');
  }

  const expiresAt = (nowMs) => (
    ttlDays > 0
      ? { ttl: Math.floor(nowMs / 1000) + Math.round(ttlDays * SECONDS_PER_DAY) }
      : {}
  );

  const write = (item) => {
    // Never awaited by the caller: the conversation must not wait on storage.
    Promise.resolve()
      .then(() => putItem(item))
      .catch((error) => {
        logger.error?.('[transcript] write failed', {
          sk: item.SK,
          message: error?.message,
        });
      });
  };

  /**
   * Binds a session to one authenticated identity for the life of a socket.
   * @param {{ oid: string, email?: string, name?: string, synthetic?: boolean }} identity
   */
  function openSession(identity, { lessonSlug = '' } = {}) {
    if (!identity?.oid) {
      throw new Error('openSession requires an identity with an oid.');
    }

    // Load-test traffic would otherwise bury real transcripts under thousands of
    // synthetic turns on every rehearsal.
    const enabled = storeSynthetic || !identity.synthetic;
    const sessionId = newSessionId();
    let sequence = 0;
    let metaWritten = false;

    // Written at sign-in, unlike the session META below, and that difference is
    // the point: a student who signs in and leaves without asking anything would
    // otherwise appear nowhere at all. This is the only record of who reached the
    // lesson, as opposed to who talked to it.
    //
    // A repeat visitor overwrites their own row, so firstSeenAt is not kept —
    // reconstructing it would need a read before every write. The earliest
    // session META serves that purpose for anyone who actually spoke.
    if (enabled) {
      const seenAtMs = now();
      write({
        PK: userPartitionKey(identity.oid),
        SK: USER_PROFILE_KEY,
        lastSeenAt: new Date(seenAtMs).toISOString(),
        email: identity.email || '',
        displayName: identity.name || '',
        ...(identity.synthetic ? { synthetic: true } : {}),
        // Slides forward on every sign-in, so an active student's row does not
        // expire underneath their still-live transcripts.
        ...expiresAt(seenAtMs),
      });
    }

    const writeMetaOnce = (startedAtMs) => {
      if (metaWritten) return;
      metaWritten = true;
      write({
        PK: userPartitionKey(identity.oid),
        SK: sessionMetaKey(sessionId),
        startedAt: new Date(startedAtMs).toISOString(),
        // Snapshots of what was true at write time — oid is the durable key.
        email: identity.email || '',
        displayName: identity.name || '',
        ...(lessonSlug ? { lessonSlug } : {}),
        ...(identity.synthetic ? { synthetic: true } : {}),
        ...expiresAt(startedAtMs),
      });
    };

    return {
      get sessionId() {
        return sessionId;
      },
      get turnCount() {
        return sequence;
      },

      /**
       * @param {{ role: 'user'|'assistant', text: string, cancelled?: boolean }} turn
       * @returns {boolean} whether the turn was written.
       */
      recordTurn({ role, text, cancelled = false }) {
        if (!enabled) return false;

        const trimmed = typeof text === 'string' ? text.trim() : '';
        // Suppressed transcripts arrive as empty strings; an empty row is noise.
        if (!trimmed) return false;
        if (role !== 'user' && role !== 'assistant') return false;
        // Dropped before writeMetaOnce, so a session where the student never
        // spoke does not get a META row off the back of a reply alone.
        if (role === 'assistant' && !storeAssistantTurns) return false;

        const atMs = now();
        // Written on the first real turn, not at connect: sockets that open and
        // go away without saying anything leave no empty session behind.
        writeMetaOnce(atMs);

        sequence += 1;
        write({
          PK: userPartitionKey(identity.oid),
          SK: turnSortKey(sessionId, sequence),
          role,
          text: trimmed,
          ts: new Date(atMs).toISOString(),
          ...(cancelled ? { cancelled: true } : {}),
          ...expiresAt(atMs),
        });
        return true;
      },
    };
  }

  return { openSession };
}
