import { resolveWsPath } from '@/lib/runtimeConfig';

const LIVE_CHAT_SOCKET_PATH = '/api/live/chat/realtime';

export function createLiveChatSocket({ onOpen, onMessage, onError, onClose } = {}) {
  const socket = new WebSocket(resolveWsPath(LIVE_CHAT_SOCKET_PATH));

  socket.addEventListener('open', (event) => {
    onOpen?.(event);
  });

  socket.addEventListener('message', (event) => {
    let message = event.data;

    try {
      message = JSON.parse(event.data);
    } catch {
      // Preserve non-JSON payloads so callers can decide how to handle them.
    }

    onMessage?.(message, event);
  });

  socket.addEventListener('error', (event) => {
    onError?.(event);
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
    close(code, reason) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(code, reason);
      }
    },
    socket,
  };
}
