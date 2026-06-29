import { WebSocket, WebSocketServer } from 'ws';
import { CORS_ORIGIN } from '../config.js';
import { OpenAiRealtimeBridge } from '../services/openaiRealtimeBridge.js';
import { normalizeRealtimeLanguage } from '../services/openaiRealtimeEvents.js';

export const LIVE_CHAT_PATH = '/api/live/chat/realtime';

export function parseRequestUrl(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url || '/', 'http://' + host);
}

export function getLiveChatLanguage(url) {
  return normalizeRealtimeLanguage(url.searchParams.get('language') || '');
}

export function originAllowed(origin, options = {}) {
  const {
    nodeEnv = process.env.NODE_ENV || 'development',
    corsOrigin = CORS_ORIGIN,
    requestHost = '',
  } = options;

  if (nodeEnv !== 'production') {
    return true;
  }

  // Browsers always send an Origin header on the WebSocket handshake, so a
  // missing Origin in production means a non-browser client (e.g. a script
  // opening the socket directly to drain the OpenAI Realtime budget). Reject it.
  if (!origin) {
    return false;
  }

  if (corsOrigin === '*') {
    return true;
  }

  const allowedOrigins = String(corsOrigin || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  try {
    const originHost = new URL(origin).host.toLowerCase();
    if (requestHost && originHost === String(requestHost).toLowerCase()) {
      return true;
    }
  } catch {
    return false;
  }

  return allowedOrigins.includes(origin);
}

export function rejectUpgrade(socket, response) {
  socket.write(response);
  socket.destroy();
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

  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
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

  if (message.type === 'input.commit') {
    bridge.commitInput();
    return;
  }

  if (message.type === 'response.cancel') {
    bridge.cancelResponse();
  }
}

export function parseLiveChatInit(data) {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch {
    return null;
  }

  if (typeof message !== 'object' || message === null || message.type !== 'session.init') {
    return null;
  }

  return {
    systemPrompt: typeof message.systemPrompt === 'string' ? message.systemPrompt : '',
  };
}

export function applyLiveChatInitToBridge(bridge, init) {
  if (init && typeof init.systemPrompt === 'string' && init.systemPrompt.trim()) {
    bridge.systemPrompt = init.systemPrompt;
  }
}

export function attachLiveChatSocket(server) {
  const wss = new WebSocketServer({ noServer: true });
  const activeClients = new Map();

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = parseRequestUrl(req);
    } catch {
      rejectUpgrade(socket, 'HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    if (url.pathname !== LIVE_CHAT_PATH) {
      rejectUpgrade(socket, 'HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }

    const origin = req.headers.origin || '';
    const requestHost = req.headers['x-forwarded-host'] || req.headers.host || '';
    if (!originAllowed(origin, { requestHost })) {
      rejectUpgrade(socket, 'HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }

    wss.handleUpgrade(req, socket, head, (browserSocket) => {
      wss.emit('connection', browserSocket, req);
    });
  });

  wss.on('connection', (browserSocket, req) => {
    const url = parseRequestUrl(req);
    const language = getLiveChatLanguage(url);
    const bridge = new OpenAiRealtimeBridge({ language });
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

    let connected = false;
    const ensureConnected = () => {
      if (connected) return;
      connected = true;
      clearTimeout(initTimer);
      bridge.connect();
    };
    // Safety net: a client that never sends session.init must not hang.
    const initTimer = setTimeout(ensureConnected, 1000);

    browserSocket.on('message', (data) => {
      if (!connected) {
        const init = parseLiveChatInit(data);
        if (init) {
          applyLiveChatInitToBridge(bridge, init);
          ensureConnected();
          return; // session.init is handshake-only; do not forward downstream.
        }
        // First real message arrived before any handshake — connect, then handle it.
        ensureConnected();
      }
      handleBrowserMessage(bridge, data);
    });

    const closeBridge = () => {
      activeClients.delete(browserSocket);
      clearTimeout(initTimer);
      bridge.close();
    };

    browserSocket.on('close', closeBridge);
    browserSocket.on('error', closeBridge);
  });

  return {
    close() {
      for (const [client, bridge] of activeClients.entries()) {
        if (
          client.readyState === WebSocket.OPEN
          || client.readyState === WebSocket.CONNECTING
        ) {
          client.close(1001, 'Live gateway shutting down');
        }
        bridge.close();
      }

      activeClients.clear();
      wss.close();
    },
  };
}
