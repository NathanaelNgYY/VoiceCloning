import { WebSocket, WebSocketServer } from 'ws';
import { CORS_ORIGINS, ALLOW_ALL_CORS } from '../config.js';
import { OpenAiRealtimeBridge } from '../services/openaiRealtimeBridge.js';

export const LIVE_CHAT_PATH = '/api/live/chat/realtime';

export function parseRequestUrl(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url || '/', 'http://' + host);
}

export function originAllowed(origin) {
  if (!origin) {
    return true;
  }

  if (ALLOW_ALL_CORS) {
    return true;
  }

  if (CORS_ORIGINS.length === 0) {
    return true;
  }

  if (process.env.NODE_ENV !== 'production') {
    return true;
  }

  return CORS_ORIGINS.includes(origin);
}

export function sendBrowser(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export function handleBrowserMessage(bridge, data) {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch {
    return;
  }

  if (message.type === 'audio.chunk') {
    bridge.sendAudio(message.audio);
    return;
  }

  if (message.type === 'input.pause') {
    bridge.pauseInput();
    return;
  }

  if (message.type === 'input.resume') {
    bridge.resumeInput();
    return;
  }

  if (message.type === 'response.cancel') {
    bridge.cancelResponse();
  }
}

export function attachLiveChatSocket(server) {
  const wss = new WebSocketServer({ noServer: true });
  const activeClients = new Map();

  server.on('upgrade', (req, socket, head) => {
    const url = parseRequestUrl(req);
    if (url.pathname !== LIVE_CHAT_PATH) {
      return;
    }

    const origin = req.headers.origin || '';
    if (!originAllowed(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (browserSocket) => {
      wss.emit('connection', browserSocket, req);
    });
  });

  wss.on('connection', (browserSocket) => {
    const bridge = new OpenAiRealtimeBridge();
    activeClients.set(browserSocket, bridge);

    bridge.on('app-event', (payload) => {
      sendBrowser(browserSocket, payload);
    });

    bridge.on('close', () => {
      activeClients.delete(browserSocket);
      if (browserSocket.readyState === WebSocket.OPEN) {
        browserSocket.close(1000, 'Live session ended');
      }
    });

    browserSocket.on('message', (data) => {
      handleBrowserMessage(bridge, data);
    });

    const closeBridge = () => {
      activeClients.delete(browserSocket);
      bridge.close();
    };

    browserSocket.on('close', closeBridge);
    browserSocket.on('error', closeBridge);

    bridge.connect();
  });

  return {
    close() {
      for (const [client, bridge] of activeClients.entries()) {
        if (
          client.readyState === WebSocket.OPEN
          || client.readyState === WebSocket.CONNECTING
        ) {
          client.close(1001, 'Server shutting down');
        }
        bridge.close();
      }

      activeClients.clear();
      wss.close();
    },
  };
}
