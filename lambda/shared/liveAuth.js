// Bearer-token check for the synthesis routes.
//
// The live gateway authenticates the conversation; this closes the other door.
// Without it, authenticating the WebSocket still leaves /api/live/tts-sentence
// open to direct calls, so anyone could spend GPU time without signing in.
//
// Off unless LIVE_AUTH_ENABLED is set, so existing deployments are unchanged.
import { createEntraVerifier, TokenError } from './entraToken.js';

let cached = null;

function readEnv(env) {
  return {
    enabled: (env.LIVE_AUTH_ENABLED || 'false') === 'true',
    tenantId: env.ENTRA_TENANT_ID || '',
    audience: env.ENTRA_AUDIENCE || '',
    domains: (env.ENTRA_ALLOWED_EMAIL_DOMAINS || '')
      .split(',')
      .map((domain) => domain.trim())
      .filter(Boolean),
    loadTestSecret: env.LIVE_AUTH_LOADTEST_SECRET || '',
  };
}

export function readBearerToken(event) {
  const headers = event?.headers || {};
  const entraKey = Object.keys(headers).find((name) => name.toLowerCase() === 'x-vcs-entra-token');
  const entraToken = entraKey ? String(headers[entraKey] || '').trim() : '';
  if (entraToken) return entraToken;
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'authorization');
  const raw = key ? String(headers[key] || '').trim() : '';
  return /^Bearer\s+/iu.test(raw) ? raw.replace(/^Bearer\s+/iu, '').trim() : '';
}

/**
 * Builds the guard. Returns null when authentication is off, so the caller keeps
 * its previous behaviour exactly.
 *
 * The verifier is module-scoped on purpose: Lambda reuses a warm container, so the
 * JWKS cache survives between invocations instead of refetching on every request.
 */
export function createLiveAuthGuard({ env = process.env, verifier = null } = {}) {
  const config = readEnv(env);
  if (!config.enabled) return null;

  if (!config.tenantId || !config.audience) {
    // Fail closed. A route that believes it is protected but is not is worse than
    // one that is plainly refusing.
    console.error(
      '[live-auth] LIVE_AUTH_ENABLED is on but ENTRA_TENANT_ID/ENTRA_AUDIENCE are missing; '
      + 'refusing all synthesis requests.',
    );
    return {
      async authorize() {
        throw new TokenError('misconfigured', 'Synthesis authentication is not configured.');
      },
    };
  }

  if (!verifier && !cached) {
    cached = createEntraVerifier({
      tenantId: config.tenantId,
      audience: config.audience,
      allowedEmailDomains: config.domains,
    });
  }
  const activeVerifier = verifier || cached;

  return {
    /**
     * @returns {Promise<{ oid: string, email: string, synthetic: boolean }>}
     * @throws {TokenError} on any failure — never returns an anonymous caller.
     */
    async authorize(event) {
      const token = readBearerToken(event);

      // Load tests hit this route with no interactive sign-in. Same separate
      // credential the gateway uses, so there is still no single switch that
      // turns authentication off.
      if (config.loadTestSecret && token === config.loadTestSecret) {
        return { oid: 'LOADTEST#lambda', email: '', synthetic: true };
      }

      const identity = await activeVerifier.verify(token);
      return { ...identity, synthetic: false };
    },
  };
}

/** Test seam: drops the warm-container verifier cache. */
export function resetLiveAuthCache() {
  cached = null;
}
