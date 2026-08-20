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

// One row per sign-in *event*, as opposed to the single overwriting PROFILE row.
// PROFILE answers "who has ever signed in, and when were they last seen";
// these answer "how often, and when each time".
//
// ISO-8601 is used raw because it sorts lexicographically in the same order it
// sorts chronologically, so a begins_with('SIGNIN#') query returns a person's
// visits oldest-first with no extra work. Two sign-ins by the same user in the
// same millisecond would collide and overwrite — not worth defending against,
// since it would take one person signing in twice inside 1ms.
export function signInEventKey(isoTimestamp) {
  return `SIGNIN#${isoTimestamp}`;
}

/**
 * Partition key of the sparse `signins-by-day` index — the ISO date alone,
 * e.g. "2026-08-06".
 *
 * Answering "who signed in today" from the base table means scanning every row
 * of every user, including transcripts, because sign-ins live under each
 * person's own partition. This index inverts that. Only SIGNIN# rows carry the
 * attribute, so the index stays sparse: a cohort's chatter never enters it, and
 * it costs in proportion to logins rather than to utterances.
 *
 * Bucketing by day rather than using one constant value avoids funnelling a
 * whole cohort's writes into a single partition. A date range is one Query per
 * day, which is the right shape for the question anyway.
 */
export function signInDayKey(isoTimestamp) {
  return isoTimestamp.slice(0, 10);
}

/**
 * Session ids lead with the ISO timestamp of the socket opening, so that
 * `SESSION#…` sort keys order chronologically.
 *
 * They used to be bare UUIDs, which sort by random hex: a student's sessions
 * came back shuffled, and "sessions between two dates" was not expressible at
 * all. Same reasoning as signInEventKey above.
 *
 * The random suffix is load-bearing rather than decoration — two sockets
 * opening for one user in the same millisecond (a fast reconnect) would
 * otherwise share an id and interleave their turns into a single transcript.
 */
export function timeOrderedSessionId(nowMs) {
  return `${new Date(nowMs).toISOString()}#${randomUUID().slice(0, 8)}`;
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
 * @param {boolean} [options.storeAssistantTurns]  Whether replies are kept, not just questions.
 */
export function createTranscriptStore({
  putItem,
  ttlDays = 0,
  storeSynthetic = false,
  storeAssistantTurns = false,
  now = () => Date.now(),
  // Receives the open time so the id can lead with it; see timeOrderedSessionId.
  newSessionId = timeOrderedSessionId,
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
   * Writes the one row that says a person reached the lesson at all, separately
   * from anything they said. Called from two places, and the reason it is public
   * is the second one:
   *
   * 1. `openSession` below, when a live-chat socket authenticates.
   * 2. The sign-in endpoint (`routes/signIn.js`), the moment the browser
   *    finishes SSO — before, and independently of, any conversation.
   *
   * Without (2) this row only ever appeared for students who pressed the
   * microphone, because that is when the socket opens. Someone who signed in,
   * read the lesson and left was recorded nowhere.
   *
   * A repeat visitor overwrites their own row, so firstSeenAt is not kept —
   * reconstructing it would need a read before every write. The earliest
   * SIGNIN# event serves that purpose.
   *
   * @param {{ oid: string, email?: string, name?: string, synthetic?: boolean }} identity
   * @param {object} [options]
   * @param {boolean} [options.event]  Also write a per-visit SIGNIN# row.
   *   Only the sign-in endpoint passes true, and the reason is the whole design:
   *   openSession calls this too, but a socket may open several times in one
   *   visit (reconnects, a student pressing the microphone again), so counting
   *   those would inflate one visit into five logins. The endpoint fires once
   *   per browser sign-in, which is what a "login" actually means here.
   *
   *   The cost of that choice: if the endpoint call fails, the visit leaves no
   *   event. PROFILE is still written by the socket path, so the person is never
   *   lost — only the timestamp of that visit is. Undercounting is recoverable;
   *   inventing logins that did not happen is not.
   * @returns {boolean} whether a write was issued (not whether it succeeded —
   *   writes are fire-and-forget by design).
   */
  function recordSignIn(identity, { event = false } = {}) {
    if (!identity?.oid) {
      throw new Error('recordSignIn requires an identity with an oid.');
    }

    // Load-test traffic would otherwise bury real records under thousands of
    // synthetic rows on every rehearsal.
    if (identity.synthetic && !storeSynthetic) {
      return false;
    }

    const seenAtMs = now();
    const seenAt = new Date(seenAtMs).toISOString();
    const who = {
      email: identity.email || '',
      displayName: identity.name || '',
      ...(identity.synthetic ? { synthetic: true } : {}),
    };

    write({
      PK: userPartitionKey(identity.oid),
      SK: USER_PROFILE_KEY,
      lastSeenAt: seenAt,
      GSI1PK: 'USERS',
      GSI1SK: `${seenAt}#${identity.oid}`,
      ...who,
      // Slides forward on every sign-in, so an active student's row does not
      // expire underneath their still-live transcripts.
      ...expiresAt(seenAtMs),
    });

    if (event) {
      write({
        PK: userPartitionKey(identity.oid),
        SK: signInEventKey(seenAt),
        // Duplicated from the key so the row is readable without parsing it,
        // and doubling as the sort key of the signins-by-day index.
        signedInAt: seenAt,
        // Present on these rows and no others, which is what keeps that index
        // sparse. Dropping the index later means deleting it, not rewriting
        // rows: a stray attribute on a sign-in row costs nothing.
        signInDay: signInDayKey(seenAt),
        ...who,
        // Each event expires on its own clock, unlike PROFILE — so this is a
        // rolling window of recent visits, not a permanent history. Raise
        // TRANSCRIPT_TTL_DAYS if the record needs to outlive a semester.
        ...expiresAt(seenAtMs),
      });
    }

    return true;
  }

  /**
   * Binds a session to one authenticated identity for the life of a socket.
   * @param {{ oid: string, email?: string, name?: string, synthetic?: boolean }} identity
   */
  function openSession(identity, { lessonSlug = '' } = {}) {
    if (!identity?.oid) {
      throw new Error('openSession requires an identity with an oid.');
    }

    const enabled = storeSynthetic || !identity.synthetic;
    // Stamped when the socket opens, which is the session's real start. The
    // META row's `startedAt` is later — it is written on the first turn, so
    // that a socket which never says anything leaves nothing behind.
    const sessionId = newSessionId(now());
    let sequence = 0;
    let metaWritten = false;

    // Kept even though the sign-in endpoint also writes it: the WebSocket is the
    // only path guaranteed to have run when a turn is stored, so a client that
    // never called the endpoint — or whose call failed — still produces a row.
    // Same key, so the repeat write overwrites rather than duplicating.
    //
    // Deliberately without { event: true }: sockets reopen within a single visit,
    // and a login count that rises on reconnect would be worse than no count.
    recordSignIn(identity);

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

  return { openSession, recordSignIn };
}
