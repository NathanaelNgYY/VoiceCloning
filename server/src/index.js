import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import {
  SERVER_HOST,
  SERVER_PORT,
  TRUST_PROXY,
  SERVE_CLIENT_DIST,
  CLIENT_DIST_DIR,
  CORS_ORIGINS,
  ALLOW_ALL_CORS,
  ensureRuntimeDirectories,
  getConfigError,
} from './config.js';
import { processManager } from './services/processManager.js';
import { sseManager } from './services/sseManager.js';
import { trainingState } from './services/trainingState.js';
import { inferenceServer } from './services/inferenceServer.js';
import { inferenceState } from './services/inferenceState.js';
import uploadRoutes from './routes/upload.js';
import trainingRoutes from './routes/training.js';
import inferenceRoutes from './routes/inference.js';

const app = express();

if (TRUST_PROXY) {
  app.set('trust proxy', true);
}

if (ALLOW_ALL_CORS) {
  app.use(cors());
} else if (CORS_ORIGINS.length > 0) {
  app.use(cors({
    origin(origin, callback) {
      if (!origin || CORS_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin not allowed by CORS'));
    },
  }));
} else if (process.env.NODE_ENV !== 'production') {
  app.use(cors());
}

app.use(express.json());

ensureRuntimeDirectories();

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    service: 'voice-cloning-server',
    timestamp: Date.now(),
  });
});

app.get('/readyz', (_req, res) => {
  const configError = getConfigError({ requirePython: true });
  const ready = !configError;
  res.status(ready ? 200 : 503).json({
    ready,
    configError,
    trainingStatus: trainingState.getState().status,
    inferenceStatus: inferenceState.getState().status,
  });
});

// Wire processManager events to SSE
processManager.on('log', ({ sessionId, stream, data }) => {
  const payload = { stream, data, timestamp: Date.now() };
  trainingState.appendLog(payload);
  sseManager.send(sessionId, 'log', payload);
});

// Routes
app.use('/api', uploadRoutes);
app.use('/api', trainingRoutes);
app.use('/api', inferenceRoutes);

if (SERVE_CLIENT_DIST) {
  const indexPath = path.join(CLIENT_DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    app.use(express.static(CLIENT_DIST_DIR));
    app.get(/^\/(?!api(?:\/|$)|healthz$|readyz$).*/u, (_req, res) => {
      res.sendFile(indexPath);
    });
  } else {
    console.warn(`[client] SERVE_CLIENT_DIST is enabled, but no build was found at ${CLIENT_DIST_DIR}`);
  }
}

// Prevent server crashes from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

const server = app.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`Server running on http://${SERVER_HOST}:${SERVER_PORT}`);
});

// Disable server timeout so SSE connections survive long training runs
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[shutdown] Received ${signal}, stopping services...`);
  processManager.killAll();
  inferenceServer.stop();

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
