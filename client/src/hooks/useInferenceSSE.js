import { useState, useEffect, useRef, useCallback } from 'react';
import { connectInferenceSSE } from '../services/sse.js';

export function useInferenceSSE() {
  const [status, setStatus] = useState('idle'); // idle | waiting | generating | complete | error | cancelled
  const [totalChunks, setTotalChunks] = useState(0);
  const [completedChunks, setCompletedChunks] = useState(0);
  const [currentChunkText, setCurrentChunkText] = useState('');
  const [error, setError] = useState(null);
  const esRef = useRef(null);

  const hydrate = useCallback((initialState = {}) => {
    const {
      initialStatus = 'idle',
      initialTotalChunks = 0,
      initialCompletedChunks = 0,
      initialCurrentChunkText = '',
      initialError = null,
    } = initialState;

    setStatus(initialStatus);
    setTotalChunks(initialTotalChunks);
    setCompletedChunks(initialCompletedChunks);
    setCurrentChunkText(initialCurrentChunkText);
    setError(initialError);
  }, []);

  const connect = useCallback((sessionId, initialState = {}) => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    hydrate({
      initialStatus: initialState.initialStatus || 'waiting',
      initialTotalChunks: initialState.initialTotalChunks || 0,
      initialCompletedChunks: initialState.initialCompletedChunks || 0,
      initialCurrentChunkText: initialState.initialCurrentChunkText || '',
      initialError: initialState.initialError || null,
    });

    esRef.current = connectInferenceSSE(sessionId, {
      onStart(data) {
        setStatus('generating');
        setTotalChunks(data.totalChunks);
      },
      onChunkStart(data) {
        setStatus('generating');
        setCurrentChunkText(data.text);
      },
      onChunkComplete(data) {
        setCompletedChunks(data.index + 1);
      },
      onComplete() {
        setStatus('complete');
        setCurrentChunkText('');
      },
      onError(data) {
        const isCancelled = data?.message?.includes('cancelled');
        setStatus(isCancelled ? 'cancelled' : 'error');
        setError(data?.message || 'Unknown error');
        setCurrentChunkText('');
      },
    });
  }, []);

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    disconnect();
    hydrate();
  }, [disconnect, hydrate]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return { status, totalChunks, completedChunks, currentChunkText, error, connect, disconnect, hydrate, reset };
}
