class SSEManager {
  constructor() {
    this.clients = new Map(); // sessionId -> { res, heartbeat }
    this.buffers = new Map(); // sessionId -> [{ event, data }]
    this.waiters = new Map(); // sessionId -> resolve function
  }

  // Call this before starting the pipeline to buffer events until client connects
  prepareSession(sessionId) {
    this.buffers.set(sessionId, []);
  }

  // Returns a promise that resolves when the SSE client connects
  waitForClient(sessionId, timeoutMs = 5000) {
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
    // Disable request timeout and Node's socket timeout
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

    // Send heartbeat comment every 15s to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    this.clients.set(sessionId, { res, heartbeat });

    // Flush any buffered events
    const buffer = this.buffers.get(sessionId);
    if (buffer) {
      for (const msg of buffer) {
        res.write(`event: ${msg.event}\ndata: ${JSON.stringify(msg.data)}\n\n`);
      }
      this.buffers.delete(sessionId);
    }

    // Resolve anyone waiting for this client
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

    // Buffer the event if session is prepared but client hasn't connected yet
    const buffer = this.buffers.get(sessionId);
    if (buffer) {
      buffer.push({ event, data });
    }
  }

  hasClient(sessionId) {
    return this.clients.has(sessionId);
  }
}

export const sseManager = new SSEManager();
