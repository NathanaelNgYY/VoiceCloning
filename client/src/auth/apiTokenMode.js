// Which token, if any, this build sends to its own backends.
//
// Split out of msalClient.js because that module cannot be imported under
// `node --test` — it pulls in MSAL and import.meta.env. The decision itself is
// pure, and it is the part worth testing: every failure mode here looks like a
// working sign-in from the browser and a silent rejection at the backend.

export const NO_TOKEN = "none";
/** Access token, `aud` = api://<clientId>. Needs `access_as_user` exposed. */
export const ACCESS_TOKEN = "access";
/** ID token, `aud` = <clientId>. Needs no portal work at all. */
export const ID_TOKEN = "id";

/**
 * @param {object} options
 * @param {boolean} options.msalEnabled   Real identity provider, not the mock gate.
 * @param {string}  options.apiAuthMode   VITE_API_AUTH_MODE.
 * @param {string}  options.entraApiScope VITE_ENTRA_API_SCOPE.
 * @returns {typeof NO_TOKEN | typeof ACCESS_TOKEN | typeof ID_TOKEN}
 */
export function resolveApiTokenMode({ msalEnabled, apiAuthMode, entraApiScope }) {
  // "mock" auth has no token to send, whatever the other two say.
  if (!msalEnabled) return NO_TOKEN;
  if (apiAuthMode === "entra-id") return ID_TOKEN;
  // A scope-less "entra" is not a usable access-token build: acquireTokenSilent
  // has nothing to ask for. Treated as off rather than half-configured.
  if (apiAuthMode === "entra" && entraApiScope) return ACCESS_TOKEN;
  return NO_TOKEN;
}

/**
 * The custom scope to append to the *login* request, if any.
 *
 * Only the access-token mode may widen sign-in. MSAL sends whatever is here as
 * part of the login itself, so a scope the registration does not expose fails
 * the whole sign-in with AADSTS65005 — not the later API call, which is where
 * you would think to look.
 */
export function loginApiScope(options) {
  return resolveApiTokenMode(options) === ACCESS_TOKEN ? options.entraApiScope : "";
}
