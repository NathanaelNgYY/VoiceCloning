// Turns the first frame of a live-chat WebSocket into a caller identity.
//
// The token travels in a frame rather than the connect URL on purpose: browsers
// cannot set an Authorization header on a WebSocket, and a query string would be
// written to CloudFront and ALB access logs — durable stores we do not control.
import { createHash, timingSafeEqual } from 'node:crypto';

import { TokenError } from './entraToken.js';

// Generous enough for a redirect-flow token acquisition that lands slowly, short
// enough that unauthenticated sockets do not accumulate.
export const AUTH_TIMEOUT_MS = 10_000;

// Application close codes (4000-4999 is the app-defined range).
export const AUTH_CLOSE_CODES = {
  unauthorized: 4401,
  forbidden: 4403,
  timeout: 4408,
};

// Load-test users are capped so a bad value cannot spray unbounded synthetic
// partitions across the transcript table.
const MAX_LOAD_TEST_USER = 999;

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

// Compares hashes so the check is constant-time regardless of input length.
function secretMatches(supplied, expected) {
  return timingSafeEqual(digest(supplied), digest(expected));
}

/**
 * Reads a `session.auth` handshake frame. Returns null for anything else, so a
 * client that opens with the wrong frame is rejected rather than misread.
 */
export function parseAuthFrame(data) {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch {
    return null;
  }

  if (typeof message !== 'object' || message === null || message.type !== 'session.auth') {
    return null;
  }

  return {
    token: typeof message.token === 'string' ? message.token : '',
    loadTestSecret: typeof message.loadTestSecret === 'string' ? message.loadTestSecret : '',
    loadTestUser: Number.isInteger(message.loadTestUser) ? message.loadTestUser : 0,
  };
}

/**
 * @param {object} options
 * @param {{ verify: (token: string) => Promise<object> }} options.verifier
 * @param {string} [options.loadTestSecret]  Empty disables the bypass entirely.
 */
export function createLiveChatAuthenticator({ verifier, loadTestSecret = '' }) {
  if (!verifier) throw new Error('createLiveChatAuthenticator requires a verifier.');

  /**
   * @returns {Promise<{ oid: string, email: string, name: string, synthetic: boolean }>}
   */
  async function authenticate(frame) {
    if (!frame) {
      throw new TokenError('missing', 'Expected a session.auth frame.');
    }

    if (frame.loadTestSecret) {
      // Deliberately a separate credential rather than a flag that switches
      // authentication off: there is no single setting that silently opens the
      // gateway, and synthetic transcripts stay identifiable in the table.
      if (!loadTestSecret) {
        throw new TokenError('forbidden', 'Load-test access is not enabled.');
      }
      if (!secretMatches(frame.loadTestSecret, loadTestSecret)) {
        throw new TokenError('forbidden', 'Load-test secret is not valid.');
      }

      const index = Math.min(Math.max(frame.loadTestUser, 0), MAX_LOAD_TEST_USER);
      return {
        oid: `LOADTEST#${index}`,
        email: '',
        name: `Load test user ${index}`,
        synthetic: true,
      };
    }

    const identity = await verifier.verify(frame.token);
    return { ...identity, synthetic: false };
  }

  return { authenticate };
}

/**
 * Maps a failure to a close code. Anything that is not a recognised token
 * failure closes as unauthorized — the default is never "let them in".
 */
export function closeCodeForError(error) {
  switch (error?.code) {
    case 'forbidden':
    case 'domain_not_allowed':
    case 'guest_account':
    case 'bad_tenant':
      return AUTH_CLOSE_CODES.forbidden;
    case 'timeout':
      return AUTH_CLOSE_CODES.timeout;
    default:
      return AUTH_CLOSE_CODES.unauthorized;
  }
}
