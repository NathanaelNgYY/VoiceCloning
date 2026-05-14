class SSEManager {
  constructor() {
    this.clients = new Map();
    this.buffers = new Map();
    this.waiters = new Map();
  }

  prepareSession(sessionId) {
    this.buffers.set(sessionId, []);
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

  send(sessionId, event, data) {
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
  }

  hasClient(sessionId) {
    return this.clients.has(sessionId);
  }
}

export const sseManager = new SSEManager();
