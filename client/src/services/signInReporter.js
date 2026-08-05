// Production wiring for the sign-in record. Kept apart from signInRecord.js for
// the same reason liveChatSocket.js is kept apart from liveChatHandshake.js:
// this file pulls in MSAL and import.meta.env, so it cannot be imported under
// `node --test`. Everything worth testing lives in the module it calls.
import { acquireApiToken, shouldAttachApiToken } from '@/auth/msalClient';
import { resolveLiveGatewayPath } from '@/lib/runtimeConfig';
import { SIGN_IN_PATH, recordSignIn } from './signInRecord.js';

/** @returns {Promise<object>} never rejects. */
export function reportSignIn() {
  return recordSignIn({
    url: resolveLiveGatewayPath(SIGN_IN_PATH),
    isTokenModeEnabled: shouldAttachApiToken,
    getToken: acquireApiToken,
    fetchImpl: typeof fetch === 'function' ? fetch.bind(globalThis) : undefined,
  });
}
