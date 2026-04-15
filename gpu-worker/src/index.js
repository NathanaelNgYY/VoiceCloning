import express from 'express';
import cors from 'cors';
import { WORKER_PORT, WORKER_HOST } from './config.js';
import trainingRoutes from './routes/training.js';
import modelsRoutes from './routes/models.js';
import transcribeRoutes from './routes/transcribe.js';
import inferenceRoutes from './routes/inference.js';
import { inferenceServer } from './services/inferenceServer.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'gpu-worker', timestamp: Date.now() });
});

app.use('/', trainingRoutes);
app.use('/', modelsRoutes);
app.use('/', transcribeRoutes);
app.use('/', inferenceRoutes);

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
