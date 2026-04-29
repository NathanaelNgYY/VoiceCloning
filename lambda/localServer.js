import fs from 'fs';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { findRoute, getRouteHandler } from './router.js';

export { findRoute };

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
}

function localPreflight() {
  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: '',
  };
}

function localError(statusCode, message) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
    body: JSON.stringify({ error: message }),
  };
}

function loadEnvFile(envUrl) {
  if (!fs.existsSync(envUrl)) {
    return;
  }

  const lines = fs.readFileSync(envUrl, 'utf-8').split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim().replace(/^\uFEFF/u, '');
    const value = trimmed.slice(separator + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadLocalEnv() {
  loadEnvFile(new URL('./.env', import.meta.url));
  loadEnvFile(new URL('./local.env', import.meta.url));
}

function headersObject(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

export async function createFunctionUrlEvent(request, lambdaPath) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const queryStringParameters = Object.fromEntries(url.searchParams.entries());
  const body = ['GET', 'HEAD', 'OPTIONS'].includes(method)
    ? undefined
    : await request.text();

  return {
    version: '2.0',
    routeKey: `${method} ${lambdaPath}`,
    rawPath: lambdaPath,
    rawQueryString: url.searchParams.toString(),
    headers: headersObject(request.headers),
    queryStringParameters,
    requestContext: {
      http: {
        method,
        path: lambdaPath,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: request.headers.get('user-agent') || '',
      },
    },
    body,
    isBase64Encoded: false,
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function toRequest(req, body) {
  const host = req.headers.host || 'localhost';
  const url = `http://${host}${req.url || '/'}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(','));
    } else if (value !== undefined) {
      headers.set(key, String(value));
    }
  }

  const init = {
    method: req.method,
    headers,
  };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(String(req.method).toUpperCase()) && body.length > 0) {
    init.body = body;
  }
  return new Request(url, init);
}

function writeLambdaResponse(res, lambdaResponse) {
  const response = lambdaResponse || localError(500, 'Lambda handler returned no response');
  const statusCode = response.statusCode || 200;
  const headers = response.headers || {};
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }

  const body = response.body || '';
  if (response.isBase64Encoded) {
    res.writeHead(statusCode);
    res.end(Buffer.from(body, 'base64'));
    return;
  }

  res.writeHead(statusCode);
  res.end(body);
}

export async function handleLocalRequest(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);

  if (method === 'OPTIONS') {
    writeLambdaResponse(res, localPreflight());
    return;
  }

  const route = findRoute(method, url.pathname);
  if (!route) {
    writeLambdaResponse(res, localError(404, `No local Lambda route for ${method} ${url.pathname}`));
    return;
  }

  try {
    const body = await readRequestBody(req);
    const request = await toRequest(req, body);
    const event = await createFunctionUrlEvent(request, url.pathname);
    const handler = await getRouteHandler(route);
    const lambdaResponse = await handler(event);
    writeLambdaResponse(res, lambdaResponse);
  } catch (error) {
    writeLambdaResponse(res, localError(500, error.message));
  }
}

export function startLocalServer({ port = Number.parseInt(process.env.PORT || '3000', 10) } = {}) {
  loadLocalEnv();
  const server = createServer(handleLocalRequest);
  server.listen(port, '0.0.0.0', () => {
    console.log(`[lambda-local] REST API listening on http://localhost:${port}`);
    console.log(`[lambda-local] GPU_WORKER_URL=${process.env.GPU_WORKER_URL || '(unset)'}`);
  });
  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  startLocalServer();
}
