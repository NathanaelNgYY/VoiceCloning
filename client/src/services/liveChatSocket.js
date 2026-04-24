import { resolveWsPath } from '@/lib/runtimeConfig';

const LIVE_CHAT_SOCKET_PATH = '/api/live/chat/realtime';

export function createLiveChatSocket({ onOpen, onMessage, onError, onClose } = {}) {
  const socket = new WebSocket(resolveWsPath(LIVE_CHAT_SOCKET_PATH));

  socket.addEventListener('open', (event) => {
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
