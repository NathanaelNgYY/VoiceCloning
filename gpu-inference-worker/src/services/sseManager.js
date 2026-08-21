import { S3_BUCKET } from '../config.js';
import { getObject, listObjects, uploadBuffer } from './s3Storage.js';

export class SSEManager {
  constructor() {
    this.clients = new Map();
    this.buffers = new Map();
    this.waiters = new Map();
    this.eventSequences = new Map();
    this.eventWrites = new Map();
  }

  prepareSession(sessionId) {
    this.buffers.set(sessionId, []);
    this.eventSequences.set(sessionId, 0);
  }

  hasPreparedSession(sessionId) {
    return this.buffers.has(sessionId) || this.eventSequences.has(sessionId);
  }

  waitForClient(sessionId, timeoutMs = 15000) {
    if (this.clients.has(sessionId)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(sessionId);
        reject(new Error('SSE client did not connect in time'));
      }, timeoutMs);
      this.waiters.set(sessionId, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  addClient(sessionId, res) {
    res.req.socket.setTimeout(0);
    res.req.socket.setNoDelay(true);
    res.req.socket.setKeepAlive(true);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('\n');

    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    this.clients.set(sessionId, { res, heartbeat });

    const buffer = this.buffers.get(sessionId);
    if (buffer) {
      for (const msg of buffer) {
        res.write(`event: ${msg.event}\ndata: ${JSON.stringify(msg.data)}\n\n`);
      }
      this.buffers.delete(sessionId);
    }

    const waiter = this.waiters.get(sessionId);
    if (waiter) {
      this.waiters.delete(sessionId);
      waiter();
    }

    res.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(sessionId);
    });
  }

  addSharedClient(sessionId, res, { pollMs = 750 } = {}) {
    if (!S3_BUCKET) return this.addClient(sessionId, res);
    res.req.socket.setTimeout(0);
    res.req.socket.setNoDelay(true);
    res.req.socket.setKeepAlive(true);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('\n');

    let closed = false;
    let lastKey = '';
    const prefix = `audio/output/${sessionId}/events/`;
    const poll = async () => {
      if (closed) return;
      try {
        const events = (await listObjects(prefix))
          .filter((item) => item.key.endsWith('.json') && item.key > lastKey)
          .sort((left, right) => left.key.localeCompare(right.key));
        for (const item of events) {
          const message = JSON.parse((await getObject(item.key)).toString('utf8'));
          res.write(`event: ${message.event}\ndata: ${JSON.stringify(message.data)}\n\n`);
          lastKey = item.key;
          if (['inference-complete', 'error'].includes(message.event)) {
            closed = true;
            clearInterval(timer);
            res.end();
            return;
          }
        }
      } catch (error) {
        console.warn(`[sse] shared session poll failed for ${sessionId}: ${error.message}`);
      }
    };
    const timer = setInterval(poll, pollMs);
    timer.unref?.();
    poll();
    res.on('close', () => {
      closed = true;
      clearInterval(timer);
    });
  }

  send(sessionId, event, data) {
    if (S3_BUCKET) {
      const sequence = this.eventSequences.get(sessionId) ?? 0;
      this.eventSequences.set(sessionId, sequence + 1);
      const key = `audio/output/${sessionId}/events/${String(sequence).padStart(8, '0')}.json`;
      const previousWrite = this.eventWrites.get(sessionId) || Promise.resolve();
      const write = previousWrite.then(() => uploadBuffer(
        key,
        Buffer.from(JSON.stringify({ event, data, recordedAt: new Date().toISOString() })),
        'application/json',
      )).catch((error) => {
        console.warn(`[sse] failed to persist ${event} for ${sessionId}: ${error.message}`);
      });
      this.eventWrites.set(sessionId, write);
    }
    const client = this.clients.get(sessionId);
    if (client) {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      return;
    }

    const buffer = this.buffers.get(sessionId);
    if (buffer) {
      buffer.push({ event, data });
    }
  }

  clearSession(sessionId) {
    this.buffers.delete(sessionId);
    this.waiters.delete(sessionId);
    this.eventSequences.delete(sessionId);
    this.eventWrites.delete(sessionId);
  }

  hasClient(sessionId) {
    return this.clients.has(sessionId);
  }
}

export const sseManager = new SSEManager();
