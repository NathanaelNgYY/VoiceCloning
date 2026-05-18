import express from 'express';
import cors from 'cors';
import { WORKER_PORT, WORKER_HOST } from './config.js';
import inferenceRoutes from './routes/inference.js';
import modelsRoutes from './routes/models.js';
import artifactRoutes from './routes/artifacts.js';
import activityRoutes from './routes/activity.js';
import { inferenceServer } from './services/inferenceServer.js';
import { buildCorsOriginOption } from './services/corsOrigin.js';

const app = express();

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: buildCorsOriginOption(CORS_ORIGIN), exposedHeaders: ['X-Word-Timestamps'] }));
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'gpu-inference-worker', timestamp: Date.now() });
});

app.use('/', inferenceRoutes);
app.use('/', modelsRoutes);
app.use('/', artifactRoutes);
app.use('/', activityRoutes);

const server = app.listen(WORKER_PORT, WORKER_HOST, () => {
  console.log(`[gpu-inference-worker] Running on http://${WORKER_HOST}:${WORKER_PORT}`);
});

server.timeout = 0;
server.keepAliveTimeout = 0;

process.on('uncaughtException', (err) => console.error('[gpu-inference-worker] UNCAUGHT', err));
process.on('unhandledRejection', (r) => console.error('[gpu-inference-worker] UNHANDLED', r));

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[gpu-inference-worker] Received ${signal}, shutting down...`);
  inferenceServer.stop();
  server.close(() => { process.exit(0); });
  setTimeout(() => { process.exit(1); }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
