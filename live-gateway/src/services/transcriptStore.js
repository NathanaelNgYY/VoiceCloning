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
 */
export function createTranscriptStore({
  putItem,
  ttlDays = 0,
  storeSynthetic = false,
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
