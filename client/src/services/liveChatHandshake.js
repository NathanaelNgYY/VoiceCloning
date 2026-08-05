// Frame ordering for the live-chat socket, kept separate from the WebSocket
// plumbing so the rule it enforces can be tested directly.
//
// The rule: when the gateway has authentication on, `session.auth` must be the
// very first frame it sees. Anything the app tries to send while the token is
// being acquired has to wait, or the gateway reads it as the handshake, fails to
// parse it, and closes the socket with 4401.

// A stalled handshake ends in a close, so this only has to cover a normal token
// acquisition — roughly six seconds of 100 ms audio frames.
export const MAX_QUEUED_FRAMES = 64;

/**
 * @param {object} options
 * @param {(payload: object) => void} options.send  Raw send; must not throw.
 */
export function createHandshakeSequencer({ send }) {
  let complete = false;
  const queued = [];

  return {
    get isComplete() {
      return complete;
    },

    get queuedCount() {
      return queued.length;
    },

    /**
     * Sends the handshake frames in order, then releases anything queued behind
     * them. Rejects if the token cannot be acquired, leaving the sequencer
     * incomplete so the caller can close the socket.
     *
     * @param {{ getAuthToken?: (() => Promise<string>) | null, systemPrompt?: string }} options
     */
    async run({ getAuthToken = null, systemPrompt = '' } = {}) {
      if (getAuthToken) {
        const token = await getAuthToken();
        send({ type: 'session.auth', token });
      }

      // The gateway defers connecting to OpenAI until it sees this.
      send({ type: 'session.init', systemPrompt: systemPrompt || '' });

      complete = true;
      while (queued.length > 0) {
        send(queued.shift());
      }
    },

    /**
     * Sends a frame, or queues it if the handshake is still in flight.
     * @returns {boolean} false when the queue is full and the frame was dropped.
     */
    offer(payload) {
      if (complete) {
        send(payload);
        return true;
      }

      if (queued.length >= MAX_QUEUED_FRAMES) {
        return false;
      }

      queued.push(payload);
      return true;
    },
  };
}
