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
  getConfigError,
} from './config.js';
import voicesRoutes from './routes/voices.js';
import ttsRoutes from './routes/tts.js';
import { attachLiveChatSocket } from './routes/liveChat.js';

const app = express();

if (TRUST_PROXY) app.set('trust proxy', true);

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

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'voice-cloning-server', timestamp: Date.now() });
});

app.get('/readyz', (_req, res) => {
  const configError = getConfigError();
  const ready = !configError;
  res.status(ready ? 200 : 503).json({ ready, configError });
});

app.get('/api/config', (_req, res) => {
  res.json({ storageMode: 'local' });
});

app.use('/api', voicesRoutes);
app.use('/api', ttsRoutes);

if (SERVE_CLIENT_DIST) {
  const indexPath = path.join(CLIENT_DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    app.use(express.static(CLIENT_DIST_DIR));
    app.get(/^\/(?!api(?:\/|$)|healthz$|readyz$).*/u, (_req, res) => {
      res.sendFile(indexPath);
    });
  } else {
    console.warn(`[client] SERVE_CLIENT_DIST is enabled but no build found at ${CLIENT_DIST_DIR}`);
  }
}

process.on('uncaughtException', (err) => console.error('[UNCAUGHT EXCEPTION]', err));
process.on('unhandledRejection', (reason) => console.error('[UNHANDLED REJECTION]', reason));

const server = app.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`Server running on http://${SERVER_HOST}:${SERVER_PORT}`);
});
const liveChatSocket = attachLiveChatSocket(server);

server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] Received ${signal}, stopping services...`);
  liveChatSocket.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
