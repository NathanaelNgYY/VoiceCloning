import express from 'express';
import cors from 'cors';
import { WORKER_PORT, WORKER_HOST } from './config.js';
import trainingRoutes from './routes/training.js';
import modelsRoutes from './routes/models.js';
import transcribeRoutes from './routes/transcribe.js';
import inferenceRoutes from './routes/inference.js';
import artifactRoutes from './routes/artifacts.js';
import activityRoutes from './routes/activity.js';
import { inferenceServer } from './services/inferenceServer.js';
import { processManager } from './services/processManager.js';
import { sseManager } from './services/sseManager.js';
import { trainingState } from './services/trainingState.js';
import { activityState } from './services/activityState.js';

const app = express();

processManager.on('log', ({ sessionId, stream, data }) => {
  const payload = { stream, data, timestamp: Date.now() };
  trainingState.appendLog(payload);
  sseManager.send(sessionId, 'log', payload);
});
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.use((req, _res, next) => {
  if (req.path !== '/healthz' && req.path !== '/activity/status') {
    activityState.mark();
  }
  next();
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'gpu-worker', timestamp: Date.now() });
});

app.use('/', trainingRoutes);
app.use('/', modelsRoutes);
app.use('/', transcribeRoutes);
app.use('/', inferenceRoutes);
app.use('/', artifactRoutes);
app.use('/', activityRoutes);

const server = app.listen(WORKER_PORT, WORKER_HOST, () => {
  console.log(`[gpu-worker] Running on http://${WORKER_HOST}:${WORKER_PORT}`);
});

server.timeout = 0;
server.keepAliveTimeout = 0;

process.on('uncaughtException', (err) => console.error('[gpu-worker] UNCAUGHT', err));
process.on('unhandledRejection', (r) => console.error('[gpu-worker] UNHANDLED', r));

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[gpu-worker] Received ${signal}, shutting down...`);
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
