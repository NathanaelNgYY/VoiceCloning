// Tells the gateway that a student signed in, so they are recorded whether or
// not they ever start a conversation.
//
// The WebSocket path only fires when someone presses the microphone, which meant
// the majority of a cohort — sign in, read, leave — appeared in no row at all.
//
// Every dependency is injected and this module imports nothing, for the reason
// given in auth/apiTokenMode.js: anything pulling in MSAL or import.meta.env
// cannot be imported under `node --test`. The wiring lives in signInReporter.js.
//
// Fire-and-forget in every failure mode. Nothing here may block a sign-in or
// surface an error to a student: a missed record is a gap in research data, a
// blocked sign-in is a broken lesson.

export const SIGN_IN_PATH = '/api/live/session/signin';

/**
 * @param {object} deps
 * @param {string} deps.url                     Fully resolved endpoint.
 * @param {() => boolean} deps.isTokenModeEnabled  Whether this build holds a token
 *   the gateway could verify. False on the non-SSO builds, which is not an error.
 * @param {() => Promise<string>} deps.getToken
 * @param {typeof fetch} [deps.fetchImpl]
 * @returns {Promise<{ sent: boolean, ok?: boolean, status?: number, reason?: string }>}
 *   Always resolves — it never rejects.
 */
export async function recordSignIn({
  url,
  isTokenModeEnabled,
  getToken,
  fetchImpl,
  logger = console,
}) {
  // Guarded because the caller uses `void reportSignIn()`: anything that escapes
  // this function surfaces as an unhandled rejection, not as a catchable error.
  try {
    if (!isTokenModeEnabled()) {
      return { sent: false, reason: 'no_token_mode' };
    }
  } catch (error) {
    logger.warn?.('[signin] could not determine the token mode', error?.message);
    return { sent: false, reason: 'token_mode_failed' };
  }

  if (typeof fetchImpl !== 'function') {
    return { sent: false, reason: 'no_fetch' };
  }

  let token;
  try {
    token = await getToken();
  } catch (error) {
    logger.warn?.('[signin] token unavailable, sign-in not recorded', error?.message);
    return { sent: false, reason: 'token_failed' };
  }

  if (!token) {
    return { sent: false, reason: 'token_empty' };
  }

  try {
    // No body at all: the identity comes from the verified token, so there is
    // nothing a caller could put here that the gateway would trust.
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      logger.warn?.('[signin] gateway did not record the sign-in', response.status);
      return { sent: true, ok: false, status: response.status };
    }

    return { sent: true, ok: true, status: response.status };
  } catch (error) {
    logger.warn?.('[signin] could not reach the gateway', error?.message);
    return { sent: false, reason: 'network_failed' };
  }
}
