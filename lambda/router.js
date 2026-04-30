import { err, preflight } from './shared/cors.js';

export const ROUTES = [
  { name: 'ConfigFunction', methods: ['GET'], pattern: /^\/api\/config\/?$/u, modulePath: './config/index.js' },
  { name: 'UploadFunction', methods: ['POST'], pattern: /^\/api\/(?:upload|upload-ref)\/(?:presign|confirm)\/?$/u, modulePath: './upload/index.js' },
  { name: 'TrainingFunction', methods: ['GET', 'POST'], pattern: /^\/api\/train(?:\/(?:stop|current))?\/?$/u, modulePath: './training/index.js' },
  { name: 'ModelsFunction', methods: ['GET', 'POST'], pattern: /^\/api\/models(?:\/select)?\/?$/u, modulePath: './models/index.js' },
  { name: 'InferenceFunction', methods: ['GET', 'POST'], pattern: /^\/api\/inference(?:\/(?:generate|result\/[A-Za-z0-9-]+|cancel|current|status|stop))?\/?$/u, modulePath: './inference/index.js' },
  { name: 'TranscribeFunction', methods: ['POST'], pattern: /^\/api\/transcribe\/?$/u, modulePath: './transcribe/index.js' },
  { name: 'TrainingAudioFunction', methods: ['GET'], pattern: /^\/api\/(?:training-audio(?:\/file\/[^/]+\/[^/]+|\/[^/]+)|ref-audio)\/?$/u, modulePath: './training-audio/index.js' },
  { name: 'LiveFunction', methods: ['POST'], pattern: /^\/api\/live\/tts-sentence\/?$/u, modulePath: './live/index.js' },
  { name: 'InstanceFunction', methods: ['GET', 'POST'], pattern: /^\/api\/instance\/(?:status|start|idle-check)\/?$/u, modulePath: './instance/index.js' },
];

const handlerCache = new Map();

export function getMethod(event) {
  return String(event?.requestContext?.http?.method || event?.httpMethod || 'GET').toUpperCase();
}

export function getPath(event) {
  return event?.rawPath
    || event?.requestContext?.http?.path
    || event?.path
    || '/';
}

export function findRoute(method, pathname) {
  const route = ROUTES.find((entry) =>
    entry.methods.includes(method.toUpperCase()) && entry.pattern.test(pathname)
  );
  return route ? { ...route, lambdaPath: pathname } : null;
}

export async function getRouteHandler(route) {
  if (!handlerCache.has(route.modulePath)) {
    handlerCache.set(route.modulePath, import(route.modulePath).then((module) => module.handler));
  }
  return handlerCache.get(route.modulePath);
}

export async function dispatch(event) {
  const method = getMethod(event);
  const pathname = getPath(event);

  if (method === 'OPTIONS') {
    return preflight();
  }

  const route = findRoute(method, pathname);
  if (!route) {
    return err(404, `No Lambda route for ${method} ${pathname}`);
  }

  const handler = await getRouteHandler(route);
  return handler({
    ...event,
    rawPath: pathname,
    requestContext: {
      ...(event.requestContext || {}),
      http: {
        ...(event.requestContext?.http || {}),
        method,
        path: pathname,
      },
    },
  });
}
