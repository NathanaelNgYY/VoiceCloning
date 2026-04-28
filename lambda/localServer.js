import fs from 'fs';
import { createServer } from 'http';
import { fileURLToPath } from 'url';

const ROUTES = [
  { name: 'ConfigFunction', methods: ['GET'], pattern: /^\/api\/config\/?$/u, modulePath: './config/index.js' },
  { name: 'InstanceFunction', methods: ['GET', 'POST'], pattern: /^\/api\/instance\/(?:status|start)\/?$/u, modulePath: './instance/index.js' },
  { name: 'UploadFunction', methods: ['POST'], pattern: /^\/api\/(?:upload|upload-ref)\/(?:presign|confirm)\/?$/u, modulePath: './upload/index.js' },
  { name: 'TrainingFunction', methods: ['GET', 'POST'], pattern: /^\/api\/train(?:\/(?:stop|current))?\/?$/u, modulePath: './training/index.js' },
  { name: 'ModelsFunction', methods: ['GET', 'POST'], pattern: /^\/api\/models(?:\/select)?\/?$/u, modulePath: './models/index.js' },
  { name: 'InferenceFunction', methods: ['GET', 'POST'], pattern: /^\/api\/inference(?:\/(?:generate|result\/[A-Za-z0-9-]+|cancel|current|status|stop))?\/?$/u, modulePath: './inference/index.js' },
  { name: 'TranscribeFunction', methods: ['POST'], pattern: /^\/api\/transcribe\/?$/u, modulePath: './transcribe/index.js' },
  { name: 'TrainingAudioFunction', methods: ['GET'], pattern: /^\/api\/(?:training-audio(?:\/file\/[^/]+\/[^/]+|\/[^/]+)|ref-audio)\/?$/u, modulePath: './training-audio/index.js' },
  { name: 'LiveFunction', methods: ['POST'], pattern: /^\/api\/live\/tts-sentence\/?$/u, modulePath: './live/index.js' },
];

const handlerCache = new Map();

function isLoopbackOrigin(origin) {
  if (!origin) return false;

  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function resolveLocalCorsOrigin(requestOrigin, configuredOrigin = process.env.CORS_ORIGIN || '*') {
  if (!requestOrigin) {
    return configuredOrigin;
  }

  if (configuredOrigin === '*') {
    return '*';
  }

  const configuredOrigins = configuredOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configuredOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return isLoopbackOrigin(requestOrigin) ? requestOrigin : configuredOrigin;
}

function corsHeaders(req) {
  return {
    'Access-Control-Allow-Origin': resolveLocalCorsOrigin(req?.headers?.origin),
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
}

function localPreflight(req) {
  return {
    statusCode: 200,
    headers: corsHeaders(req),
    body: '',
  };
}

function localError(statusCode, message, req) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(req),
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

export function findRoute(method, pathname) {
  const route = ROUTES.find((entry) =>
    entry.methods.includes(method.toUpperCase()) && entry.pattern.test(pathname)
  );
  return route ? { ...route, lambdaPath: pathname } : null;
}

async function getRouteHandler(route) {
  if (!handlerCache.has(route.modulePath)) {
    handlerCache.set(route.modulePath, import(route.modulePath).then((module) => module.handler));
  }
  return handlerCache.get(route.modulePath);
}

function headersObject(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

export async function createApiGatewayEvent(request, lambdaPath) {
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

function writeLambdaResponse(req, res, lambdaResponse) {
  const response = lambdaResponse || localError(500, 'Lambda handler returned no response', req);
  const statusCode = response.statusCode || 200;
  const headers = {
    ...(response.headers || {}),
    ...corsHeaders(req),
  };
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
    writeLambdaResponse(req, res, localPreflight(req));
    return;
  }

  const route = findRoute(method, url.pathname);
  if (!route) {
    writeLambdaResponse(req, res, localError(404, `No local Lambda route for ${method} ${url.pathname}`, req));
    return;
  }

  try {
    const body = await readRequestBody(req);
    const request = await toRequest(req, body);
    const event = await createApiGatewayEvent(request, url.pathname);
    const handler = await getRouteHandler(route);
    const lambdaResponse = await handler(event);
    writeLambdaResponse(req, res, lambdaResponse);
  } catch (error) {
    writeLambdaResponse(req, res, localError(500, error.message, req));
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
