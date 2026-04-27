import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { CORS_ORIGIN, PORT } from './config.js';
import { attachLiveChatSocket } from './routes/liveChat.js';

const app = express();

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    service: 'voice-cloning-live-gateway',
    timestamp: Date.now(),
  });
});

const server = createServer(app);
const liveChatSocket = attachLiveChatSocket(server);

server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[live-gateway] Running on http://0.0.0.0:${PORT}`);
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[live-gateway] Received ${signal}, shutting down...`);
  liveChatSocket.close();
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => console.error('[live-gateway] UNCAUGHT', err));
process.on('unhandledRejection', (reason) => console.error('[live-gateway] UNHANDLED', reason));
