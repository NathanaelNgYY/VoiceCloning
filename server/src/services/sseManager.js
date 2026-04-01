class SSEManager {
  constructor() {
    this.clients = new Map(); // sessionId -> { res, heartbeat }
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

    res.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(sessionId);
    });
  }

  send(sessionId, event, data) {
    const client = this.clients.get(sessionId);
    if (!client) return;

    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  hasClient(sessionId) {
    return this.clients.has(sessionId);
  }
}

export const sseManager = new SSEManager();
