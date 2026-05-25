const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

function parseAllowedOrigins(configuredOrigin = CORS_ORIGIN) {
  return String(configuredOrigin || '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getRequestOrigin(eventOrOrigin) {
  if (typeof eventOrOrigin === 'string') return eventOrOrigin;
  const headers = eventOrOrigin?.headers || {};
  return headers.origin || headers.Origin || '';
}

export function resolveCorsOrigin(requestOrigin = '', configuredOrigin = CORS_ORIGIN) {
  const allowedOrigins = parseAllowedOrigins(configuredOrigin);
  if (allowedOrigins.includes('*')) return '*';
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) return requestOrigin;
  return allowedOrigins[0] || '*';
}

export function buildCorsHeaders(eventOrOrigin) {
  return {
    'Access-Control-Allow-Origin': resolveCorsOrigin(getRequestOrigin(eventOrOrigin)),
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-amz-content-sha256',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    Vary: 'Origin',
  };
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-amz-content-sha256',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  Vary: 'Origin',
};

export function applyCors(response, event) {
  return {
    ...response,
    headers: {
      ...(response.headers || {}),
      ...buildCorsHeaders(event),
    },
  };
}

export function ok(body, extraHeaders = {}, event) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      ...buildCorsHeaders(event),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

export function err(statusCode, message, event) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...buildCorsHeaders(event),
    },
    body: JSON.stringify({ error: message }),
  };
}

export function preflight(event) {
  return {
    statusCode: 200,
    headers: buildCorsHeaders(event),
    body: '',
  };
}

export function parseJsonBody(event) {
  if (!event.body) {
    return {};
  }

  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf-8')
    : event.body;
  return JSON.parse(text);
}
