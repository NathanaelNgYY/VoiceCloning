import { resolveWsPath } from '@/lib/runtimeConfig';

const LIVE_CHAT_SOCKET_PATH = '/api/live/chat/realtime';

function withLanguageParam(path, language) {
  const url = new URL(path);
  if (language) {
    url.searchParams.set('language', language);
  }
  return url.toString();
}

export function createLiveChatSocket({ language = 'en', systemPrompt = '', onOpen, onMessage, onError, onClose } = {}) {
  const socket = new WebSocket(withLanguageParam(resolveWsPath(LIVE_CHAT_SOCKET_PATH), language));

  socket.addEventListener('open', (event) => {
    // Handshake first: the gateway defers connecting to OpenAI until it sees this.
    try {
      socket.send(JSON.stringify({ type: 'session.init', systemPrompt: systemPrompt || '' }));
    } catch {
      // If the immediate send fails the gateway's timeout fallback still connects.
    }
    onOpen?.(event);
  });

  socket.addEventListener('message', (event) => {
    try {
      onMessage?.(JSON.parse(event.data), event);
    } catch (err) {
      onError?.(new Error(`Live chat message parse failed: ${err.message}`));
    }
  });

  socket.addEventListener('error', () => {
    onError?.(new Error('Live chat connection failed.'));
  });

  socket.addEventListener('close', (event) => {
    onClose?.(event);
  });

  return {
    get readyState() {
      return socket.readyState;
    },
    send(payload) {
      if (socket.readyState !== WebSocket.OPEN) {
        return false;
      }

      socket.send(JSON.stringify(payload));
      return true;
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, 'Live conversation ended');
      }
    },
  };
}
