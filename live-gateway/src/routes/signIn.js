// Records that a verified student reached the lesson, at the moment they sign in.
//
// Why this exists as an HTTP route when the WebSocket already authenticates:
// the socket only opens when someone starts a voice conversation, so the whole
// transcript path — including the PROFILE row that identifies the person — was
// invisible for anyone who signed in, read the page and left. That is most of a
// cohort on any given day.
//
// Unlike the socket, this can carry a normal Authorization header, so there is
// no handshake frame and no query string to leak into access logs.
//
// The identity is taken from the verified token and from nothing else. Nothing
// in the request body is read, so there is no field a caller could set to write
// a row under someone else's name.
import { TRANSCRIPT_TABLE_NAME } from '../config.js';

export const SIGN_IN_PATH = '/api/live/session/signin';

/**
 * Mirrors `closeCodeForError` in liveChatAuth.js, in HTTP terms. Kept separate
 * rather than shared because the two vocabularies are unrelated — and because
 * the default matters more than the mapping: anything unrecognised is 401, never
 * a success.
 */
export function statusForError(error) {
  switch (error?.code) {
    case 'forbidden':
    case 'domain_not_allowed':
    case 'guest_account':
    case 'bad_tenant':
      return 403;
    // The gateway is up but cannot verify anyone (tenant/audience missing). That
    // is our fault, not the caller's, and /readyz is already reporting it.
    case 'misconfigured':
      return 503;
    default:
      return 401;
  }
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function bearerToken(headerValue) {
  if (typeof headerValue !== 'string') {
    return '';
  }

  const match = /^Bearer\s+(\S.*)$/iu.exec(headerValue.trim());
  return match ? match[1].trim() : '';
}

/**
 * @param {object} options
 * @param {{ authenticate: (frame: object) => Promise<object> } | null} options.authenticator
 *   Null when LIVE_AUTH_ENABLED is off — there is then no verified identity to
 *   attribute a row to, so the route reports that rather than inventing one.
 * @param {{ recordSignIn: (identity: object, options?: object) => boolean } | null} options.transcriptStore
 *   Null when TRANSCRIPT_TABLE_NAME is empty (storage disabled).
 */
export function createSignInHandler({
  authenticator,
  transcriptStore,
  storageConfigured = Boolean(TRANSCRIPT_TABLE_NAME),
  logger = console,
}) {
  return async function handleSignIn(req, res) {
    if (!authenticator) {
      res.status(503).json({
        ok: false,
        code: 'auth_disabled',
        message: 'Live-chat authentication is not enabled on this gateway.',
      });
      return;
    }

    const token = bearerToken(req.headers?.authorization);
    if (!token) {
      res.status(401).json({
        ok: false,
        code: 'missing',
        message: 'Expected an Authorization: Bearer <token> header.',
      });
      return;
    }

    let identity;
    try {
      // No load-test bypass here on purpose: a load test has no interactive
      // sign-in to record, and every credential that opens a door is one more to
      // get wrong. The socket keeps its bypass; this route is token-only.
      identity = await authenticator.authenticate({ token, loadTestSecret: '', loadTestUser: 0 });
    } catch (error) {
      res.status(statusForError(error)).json({
        ok: false,
        code: error?.code || 'unauthorized',
        message: error?.message || 'Authentication failed.',
      });
      return;
    }

    // Same rule as the transcript path: storage must never be the reason a
    // student cannot use the lesson. A failed write is logged and reported in
    // the response, and the caller treats it as success either way.
    let recorded = false;
    try {
      // The only caller that passes event: true. This route fires once per
      // browser sign-in, so one row here is one login; openSession deliberately
      // does not, because sockets reopen mid-visit. See recordSignIn's docblock.
      recorded = transcriptStore?.recordSignIn(identity, { event: true }) === true;
    } catch (error) {
      logger.error?.('[signin] could not record sign-in', error?.message);
    }

    res.json({
      ok: true,
      recorded,
      // Distinguishes "storage is switched off" from "storage is on and this
      // identity was skipped" (a synthetic user). Without it both look like
      // recorded:false, and the first is a deploy mistake worth seeing.
      storage: storageConfigured ? 'enabled' : 'disabled',
    });
  };
}
