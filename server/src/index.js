import express from 'express';
import cors from 'cors';
import { SERVER_PORT } from './config.js';
import { processManager } from './services/processManager.js';
import { sseManager } from './services/sseManager.js';
import { trainingState } from './services/trainingState.js';
import uploadRoutes from './routes/upload.js';
import trainingRoutes from './routes/training.js';
import inferenceRoutes from './routes/inference.js';

const app = express();

app.use(cors());
app.use(express.json());

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

// Prevent server crashes from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

const server = app.listen(SERVER_PORT, () => {
  console.log(`Server running on http://localhost:${SERVER_PORT}`);
});

// Disable server timeout so SSE connections survive long training runs
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
