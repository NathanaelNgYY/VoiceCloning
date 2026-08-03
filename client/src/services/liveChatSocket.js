import { resolveWsPath } from '@/lib/runtimeConfig';
import { createHandshakeSequencer } from './liveChatHandshake.js';

const LIVE_CHAT_SOCKET_PATH = '/api/live/chat/realtime';

function withLanguageParam(path, language) {
  const url = new URL(path);
  if (language) {
    url.searchParams.set('language', language);
  }
  return url.toString();
}

/**
 * @param {object} options
 * @param {() => Promise<string>} [options.getAuthToken]  Omit when the gateway
 *   has authentication disabled; supplying it makes session.auth the first frame.
 */
export function createLiveChatSocket({
  language = 'en',
  systemPrompt = '',
  getAuthToken = null,
  onOpen,
  onMessage,
  onError,
  onClose,
} = {}) {
  const socket = new WebSocket(withLanguageParam(resolveWsPath(LIVE_CHAT_SOCKET_PATH), language));

  const sequencer = createHandshakeSequencer({
    send: (payload) => {
      try {
        socket.send(JSON.stringify(payload));
      } catch {
        // If the immediate send fails the gateway's timeout fallback still connects.
      }
    },
  });

  socket.addEventListener('open', (event) => {
    // Async because the token may need acquiring. Everything the app sends
    // meanwhile is queued by the sequencer, so nothing reaches the gateway ahead
    // of session.auth.
    void (async () => {
      try {
        await sequencer.run({ getAuthToken, systemPrompt });
      } catch (err) {
        onError?.(new Error(`Live chat sign-in failed: ${err.message}`));
        socket.close(1000, 'Authentication unavailable');
        return;
      }

      onOpen?.(event);
    })();
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

      return sequencer.offer(payload);
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, 'Live conversation ended');
      }
    },
  };
}
